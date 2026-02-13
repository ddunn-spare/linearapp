import type { StateDb } from "../db";
import type { OpenAIClient } from "../adapters/openaiClient";
import { createLogger } from "../lib/logger";
import { createHash } from "node:crypto";

const log = createLogger("EmbeddingService");

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export class EmbeddingService {
  constructor(
    private readonly db: StateDb,
    private readonly openai: OpenAIClient,
  ) {}

  /**
   * Build embedding text for an issue, including code change info, completer, and customer.
   */
  private buildEmbeddingText(issue: {
    identifier: string;
    title: string;
    description?: string;
    labels: string[];
    assigneeName?: string;
    projectName?: string;
    cycleName?: string;
    status: string;
  }, extras?: { prTitles?: string[]; completedBy?: string; customerName?: string; additions?: number; deletions?: number }): string {
    const parts: string[] = [
      `${issue.identifier}: ${issue.title}`,
    ];
    if (issue.description) {
      // Truncate description to keep embedding text reasonable
      parts.push(issue.description.slice(0, 500));
    }
    if (issue.labels.length > 0) {
      parts.push(`Labels: ${issue.labels.join(", ")}`);
    }
    if (issue.projectName) {
      parts.push(`Project: ${issue.projectName}`);
    }
    if (issue.status) {
      parts.push(`Status: ${issue.status}`);
    }
    if (extras?.completedBy) {
      parts.push(`Completed by: ${extras.completedBy}`);
    }
    if (extras?.customerName) {
      parts.push(`Customer: ${extras.customerName}`);
    }
    if (extras?.prTitles && extras.prTitles.length > 0) {
      parts.push(`Code changes: ${extras.prTitles.join("; ")}`);
    }
    if (extras?.additions !== undefined || extras?.deletions !== undefined) {
      parts.push(`Changes: +${extras.additions || 0} -${extras.deletions || 0} lines`);
    }
    return parts.join("\n");
  }

  /**
   * Embed a single issue (skips if text hasn't changed).
   */
  async embedIssue(issueId: string): Promise<boolean> {
    const issue = this.db.getIssueById(issueId);
    if (!issue) return false;

    const prs = issue.pullRequests || [];
    const extras = {
      prTitles: prs.map(pr => pr.title),
      completedBy: issue.snapshot.assigneeName,
      additions: prs.reduce((s, pr) => s + pr.additions, 0),
      deletions: prs.reduce((s, pr) => s + pr.deletions, 0),
    };

    const text = this.buildEmbeddingText(issue.snapshot, extras);
    const textHash = hashText(text);

    // Skip if unchanged
    const existingHash = this.db.getEmbeddingHash(issueId);
    if (existingHash === textHash) return false;

    const embedding = await this.openai.createEmbedding(text);
    this.db.upsertEmbedding(issueId, embedding, textHash, {
      identifier: issue.snapshot.identifier,
      title: issue.snapshot.title,
      assigneeName: issue.snapshot.assigneeName,
      status: issue.snapshot.status,
      projectName: issue.snapshot.projectName,
    });
    return true;
  }

  /**
   * Resync embeddings for the most recent N issues.
   * Includes code change info from PRs, user who completed, and customer linkage.
   */
  async resyncEmbeddings(limit = 100): Promise<{ embedded: number; skipped: number; errors: number }> {
    const issues = this.db.getAllIssues();
    // Sort by most recently updated first
    const sorted = issues.sort((a, b) =>
      new Date(b.snapshot.updatedAt).getTime() - new Date(a.snapshot.updatedAt).getTime()
    ).slice(0, limit);

    let embedded = 0;
    let skipped = 0;
    let errors = 0;

    // Process in batches to avoid rate limits
    const batchSize = 20;
    for (let i = 0; i < sorted.length; i += batchSize) {
      const batch = sorted.slice(i, i + batchSize);
      const textsToEmbed: Array<{ issueId: string; text: string; metadata: Record<string, unknown> }> = [];

      for (const issue of batch) {
        const prs = issue.pullRequests || [];
        const extras = {
          prTitles: prs.map(pr => pr.title),
          completedBy: issue.snapshot.assigneeName,
          additions: prs.reduce((s, pr) => s + pr.additions, 0),
          deletions: prs.reduce((s, pr) => s + pr.deletions, 0),
        };

        const text = this.buildEmbeddingText(issue.snapshot, extras);
        const textHash = hashText(text);

        const existingHash = this.db.getEmbeddingHash(issue.snapshot.issueId);
        if (existingHash === textHash) {
          skipped++;
          continue;
        }

        textsToEmbed.push({
          issueId: issue.snapshot.issueId,
          text,
          metadata: {
            identifier: issue.snapshot.identifier,
            title: issue.snapshot.title,
            textHash,
            assigneeName: issue.snapshot.assigneeName,
            status: issue.snapshot.status,
            projectName: issue.snapshot.projectName,
          },
        });
      }

      if (textsToEmbed.length === 0) continue;

      try {
        const embeddings = await this.openai.createEmbeddingBatch(
          textsToEmbed.map(t => t.text)
        );

        for (let j = 0; j < textsToEmbed.length; j++) {
          const item = textsToEmbed[j];
          const textHash = (item.metadata.textHash as string) || "";
          this.db.upsertEmbedding(item.issueId, embeddings[j], textHash, item.metadata);
          embedded++;
        }
      } catch (e) {
        log.warn("Embedding batch failed", { error: e instanceof Error ? e.message : "unknown", batchStart: i });
        errors += textsToEmbed.length;
      }
    }

    log.info("Resync embeddings complete", { embedded, skipped, errors, total: sorted.length });
    return { embedded, skipped, errors };
  }

  /**
   * Find similar issues using cosine similarity on stored embeddings.
   */
  async findSimilar(query: string, limit = 5): Promise<Array<{
    issueId: string;
    identifier: string;
    title: string;
    similarity: number;
    assigneeName?: string;
    status?: string;
  }>> {
    const queryEmbedding = await this.openai.createEmbedding(query);
    const allEmbeddings = this.db.getAllEmbeddings();

    if (allEmbeddings.length === 0) {
      log.debug("No embeddings in store — falling back to text search");
      return [];
    }

    const scored = allEmbeddings.map(e => ({
      issueId: e.issueId,
      similarity: cosineSimilarity(queryEmbedding, e.embedding),
      metadata: e.metadata,
    }));

    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, limit).map(s => ({
      issueId: s.issueId,
      identifier: String(s.metadata.identifier || ""),
      title: String(s.metadata.title || ""),
      similarity: Math.round(s.similarity * 1000) / 1000,
      assigneeName: s.metadata.assigneeName as string | undefined,
      status: s.metadata.status as string | undefined,
    }));
  }
}
