import Fastify from "fastify";
import cors from "@fastify/cors";
import type { AppConfig } from "./config";
import type { TrackedMemberStatus, BoardColumnId } from "@linearapp/shared";
import { StateDb } from "./db";
import { LinearGraphqlClient } from "./adapters/linearGraphql";
import { GithubClient } from "./adapters/githubClient";
import { OpenAIClient } from "./adapters/openaiClient";
import { LinearSyncService } from "./services/linearSyncService";
import { GithubSyncService } from "./services/githubSyncService";
import { SyncOrchestrator } from "./services/syncService";
import { ChatService } from "./services/chatService";
import { SkillService } from "./services/skillService";
import { ActionStateMachine } from "./services/actionStateMachine";
import { ApprovalManager } from "./services/approvalManager";
import { createToolHandlers } from "./tools/index";
import { EnrichmentService } from "./services/enrichmentService";
import { EmbeddingService } from "./services/embeddingService";
import { registerHealthRoutes } from "./routes/health";
import { registerSyncRoutes } from "./routes/sync";
import { registerMemberRoutes } from "./routes/members";
import { registerBoardRoutes } from "./routes/board";
import { registerCycleRoutes } from "./routes/cycles";
import { registerOkrRoutes } from "./routes/okrs";
import { registerIssueRoutes } from "./routes/issues";
import { registerDashboardRoutes } from "./routes/dashboard";
import { registerGithubRoutes } from "./routes/github";
import { registerChatRoutes } from "./routes/chat";
import { registerOverviewRoutes } from "./routes/overview";
import { registerSkillRoutes } from "./routes/skills";
import { registerClientRoutes } from "./routes/clients";
import { registerProjectRoutes } from "./routes/projects";
import fs from "node:fs";
import path from "node:path";

export const createApp = async (cfg: AppConfig) => {
  // Ensure state directory exists
  fs.mkdirSync(cfg.stateRoot, { recursive: true });

  // Initialize core services
  const db = new StateDb(cfg.dbPath);
  const linear = new LinearGraphqlClient(cfg);
  const github = new GithubClient(cfg);
  const openai = new OpenAIClient(cfg);
  const linearSync = new LinearSyncService(cfg, db, linear);
  const githubSync = new GithubSyncService(db, github);
  const syncOrchestrator = new SyncOrchestrator(db, linearSync, githubSync);
  const trackedLinearIds = new Set(cfg.trackedMembers.map(m => m.linearUserId));
  const chatService = new ChatService(db, openai, linear, cfg, trackedLinearIds);
  const actionStateMachine = new ActionStateMachine(db);
  const toolHandlers = createToolHandlers(db, linear, cfg, trackedLinearIds, embeddingService);
  const approvalManager = new ApprovalManager(actionStateMachine, toolHandlers, db);
  chatService.setApprovalManager(approvalManager);
  const skillService = new SkillService(db, openai);
  chatService.setSkillService(skillService);
  const enrichmentService = new EnrichmentService(db, openai);
  const embeddingService = new EmbeddingService(db, openai);

  // Create Fastify app
  const app = Fastify({ logger: { level: cfg.logLevel } });

  // CORS
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || cfg.corsOrigin === "*") {
        callback(null, true);
        return;
      }
      const allowed = cfg.corsOrigin.split(",").map(s => s.trim());
      const isAllowed = allowed.some(a => origin === a || origin.replace("localhost", "127.0.0.1") === a || origin.replace("127.0.0.1", "localhost") === a);
      callback(null, isAllowed || true); // Allow all for local dev
    },
    credentials: true,
  });

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Unhandled route error");
    const err = error as Error & { statusCode?: number };
    const statusCode = typeof err.statusCode === "number" ? err.statusCode : 500;
    return reply.status(statusCode >= 400 && statusCode <= 599 ? statusCode : 500).send({
      ok: false,
      error: err.message || "Internal server error",
      ...(cfg.exposeErrorDetails ? { stack: err.stack } : {}),
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({ ok: false, error: "Route not found" });
  });

  // Register all routes
  registerHealthRoutes(app, db, linear);
  registerSyncRoutes(app, syncOrchestrator, linear);
  registerMemberRoutes(app, db, trackedLinearIds);
  registerBoardRoutes(app, db, linear, cfg);
  registerCycleRoutes(app, db, trackedLinearIds);
  registerOkrRoutes(app, db);
  registerIssueRoutes(app, db);
  registerDashboardRoutes(app, db, trackedLinearIds);
  registerGithubRoutes(app, db);
  registerChatRoutes(app, db, chatService, approvalManager);
  registerOverviewRoutes(app, db, openai, trackedLinearIds);
  registerSkillRoutes(app, skillService);
  registerClientRoutes(app, db);
  registerProjectRoutes(app, db);

  // Seed built-in skills (only inserts if skill with that name doesn't already exist)
  {
    const now = new Date().toISOString();
    const seedSkills: Array<{ name: string; description: string; category: string; tags: string[]; template: string }> = [];

    // 1. Original SKILL.md-based skill
    try {
      const skillMdPath = path.resolve(__dirname, "..", "..", "..", "skills", "linear-chat-backlog-ops", "SKILL.md");
      if (fs.existsSync(skillMdPath)) {
        const raw = fs.readFileSync(skillMdPath, "utf-8");
        const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        seedSkills.push({
          name: "Linear Chat Backlog Ops",
          description: "Operate the Linear PM Agent chat rail for backlog prioritization and permission-gated write actions. Use when asked to rank backlog items by importance, easier execution, and OKR alignment, list reference users/statuses/OKRs, save local edits as drafts, or request approval before writing updates to Linear.",
          category: "backlog",
          tags: ["linear", "backlog", "prioritization"],
          template: fmMatch?.[2]?.trim() || raw,
        });
      }
    } catch { /* skip */ }

    // 2. Team Throughput & Velocity
    seedSkills.push({
      name: "Team Throughput & Velocity",
      description: "Analyze team velocity, throughput trends, shipped work breakdown by member and category. Use when asked about how much work the team shipped, velocity trends, who shipped what, completion rates, or productivity metrics.",
      category: "analytics",
      tags: ["velocity", "throughput", "shipped", "productivity"],
      template: `# Team Throughput & Velocity

When the user asks about throughput, velocity, or what the team shipped:

## Data gathering
1. Call \`get_dashboard_summary\` for current in-flight and completed counts.
2. Call \`get_team_workload\` for per-member WIP and active issues.
3. Call \`query_data\` to get recently completed issues:
   \`SELECT identifier, title, assignee_name, completed_at, board_column FROM issues WHERE board_column = 'done' ORDER BY completed_at DESC LIMIT 20\`

## Response format
- Lead with a **summary stat line**: "X issues completed this cycle, Y currently in-flight."
- Break down by **member**: name, issues completed, issues in-progress.
- Break down by **category** if labels are available (bug, feature, tech-debt).
- Flag anyone with **zero completions** this cycle — they may be blocked or ramping up.
- Compare to previous cycle if data is available.
- Use tables for clarity when showing per-member breakdowns.

## Tone
Be factual and concise. Avoid judgmental language — frame low throughput as "may need attention" not "underperforming."`,
    });

    // 3. Sprint/Cycle Progress
    seedSkills.push({
      name: "Sprint Progress Report",
      description: "Provide detailed cycle/sprint progress including burndown, scope changes, at-risk items, and per-member breakdown. Use when asked about sprint status, cycle progress, burndown, how the sprint is going, or whether the team will hit their target.",
      category: "cycles",
      tags: ["sprint", "cycle", "burndown", "progress"],
      template: `# Sprint Progress Report

When the user asks about sprint or cycle progress:

## Data gathering
1. Call \`get_cycle_stats\` for the active cycle's burndown, progress %, and member breakdown.
2. Call \`get_team_workload\` for current WIP distribution.
3. If rollover risk items exist, highlight them prominently.

## Response format
- **Headline**: "Cycle [name]: X% complete (Y of Z issues done) with N days remaining."
- **Burndown assessment**: Is the team ahead, on track, or behind the ideal line? Quantify the gap.
- **Per-member breakdown** (table): assigned / completed / in-progress / todo for each member.
- **Rollover risks**: List issues that have been in the same status for too long, with assignee and days stalled.
- **Scope change note**: If total_scope_count seems high relative to completed + in-progress, mention possible scope creep.

## Recommendations
- If behind pace: suggest which items could be descoped or deprioritized.
- If a member has high todo but low in-progress: suggest they may need help unblocking.
- If ahead of pace: note the team is in good shape and could pull in stretch items.`,
    });

    // 4. Blockers & Risk Detection
    seedSkills.push({
      name: "Blockers & Risk Detection",
      description: "Identify blocked work, stale issues, WIP limit violations, and items at risk of rolling over. Use when asked about what's blocked, what's stuck, any risks, stale items, or issues that haven't moved.",
      category: "risk",
      tags: ["blockers", "risk", "stale", "stuck", "wip"],
      template: `# Blockers & Risk Detection

When the user asks about blockers, stuck items, or risks:

## Data gathering
1. Call \`get_cycle_stats\` and examine rollover risk items.
2. Call \`get_team_workload\` to find WIP limit violations (anyone with 5+ in-progress).
3. Call \`query_data\` to find stale in-progress items:
   \`SELECT identifier, title, assignee_name, status, updated_at, julianday('now') - julianday(updated_at) as days_stale FROM issues WHERE board_column IN ('in_progress', 'in_review') AND julianday('now') - julianday(updated_at) > 3 ORDER BY days_stale DESC\`
4. Call \`query_data\` to find items in backlog/todo with no assignee:
   \`SELECT identifier, title, status, priority FROM issues WHERE board_column IN ('backlog', 'todo') AND assignee_id IS NULL AND priority <= 2 ORDER BY priority ASC LIMIT 10\`

## Response format
- **Critical blockers first**: Items stale > 5 days in in_progress or in_review. Flag with assignee.
- **WIP violations**: Members exceeding the 5-item WIP limit. List their in-flight items.
- **Rollover risks**: Issues likely to miss the cycle end date based on days remaining and current status.
- **Unassigned high-priority**: High/urgent items with no owner.

## For each blocker, explain:
- What the issue is (identifier + title)
- Who owns it
- How long it's been stuck
- A suggested next step (reassign, break into smaller tasks, pair with someone, descope)

## Tone
Be direct and action-oriented. The goal is to surface problems and suggest concrete fixes, not just list problems.`,
    });

    // 5. OKR Progress & Alignment
    seedSkills.push({
      name: "OKR Progress & Alignment",
      description: "Show OKR progress, key result status, alignment gaps, and which work maps to which objectives. Use when asked about OKRs, objectives, key results, goal progress, alignment, or whether the team is on track for quarterly goals.",
      category: "okrs",
      tags: ["okr", "objectives", "key-results", "alignment", "goals"],
      template: `# OKR Progress & Alignment

When the user asks about OKRs, goal progress, or alignment:

## Data gathering
1. Call \`get_okrs\` for all OKRs with key results and progress.
2. Call \`get_dashboard_summary\` for the overall OKR progress number.
3. If the user asks about alignment for specific issues, call \`evaluate_okr_fit\` for those issues.

## Response format

### Overall OKR Health
- **Headline**: "Q[N] OKRs: X% average progress across Y objectives."
- For each OKR, show:
  - Objective text and owner
  - Overall progress % with a visual indicator (on-track / at-risk / behind)
  - Each key result: description, current vs target, progress %

### Progress assessment rules
- **On track** (green): progress % >= (days elapsed in quarter / total days in quarter) * 100
- **At risk** (yellow): progress is 10-25% behind pace
- **Behind** (red): progress is >25% behind pace

### Alignment insights
- Flag any OKR with 0 linked issues — it may be unmeasured or forgotten.
- Flag any OKR where progress has not changed in >2 weeks.
- If asked about a specific issue's alignment, use \`evaluate_okr_fit\` and explain which OKR it supports and how strongly.

### Recommendations
- For behind-pace OKRs: suggest which backlog items could move the needle.
- For at-risk key results: identify what's blocking progress.
- For well-progressing OKRs: acknowledge the team's progress briefly.`,
    });

    // 6. Workload Balance & Assignment
    seedSkills.push({
      name: "Workload Balance & Assignment",
      description: "Analyze team workload distribution, identify who is overloaded or has capacity, and recommend assignments. Use when asked who is free, who is overloaded, who should take a task, workload balance, or capacity.",
      category: "team",
      tags: ["workload", "assignment", "capacity", "balance", "overload"],
      template: `# Workload Balance & Assignment

When the user asks about workload, capacity, or who should take work:

## Data gathering
1. Call \`get_team_workload\` for every member's WIP counts and active issues.
2. Call \`get_dashboard_summary\` for team-wide stats.
3. If recommending an assignee for a specific issue, call \`recommend_assignee\` with the issue ID.

## Response format

### Team Overview (table)
| Member | In-Progress | In-Review | Total WIP | Status |
Show each member with their counts. Status: green (0-2), yellow (3-4), red (5+).

### Overloaded members (WIP >= 5)
For each: list their current in-flight issues by identifier + title. Suggest which item could be reassigned or deprioritized.

### Available capacity (WIP <= 2)
List members with bandwidth. Note their recent areas of work if visible from current issues.

### Assignment recommendations
When asked "who should take X":
- Check WIP counts — never assign to someone already at 5+.
- Prefer members with relevant recent experience (same project/labels).
- Prefer members with lowest current WIP.
- If using \`recommend_assignee\`, explain the reasoning (expertise match, capacity, history).

## Key principle
Flow over utilization. It's better to have someone slightly idle than to overload everyone. A team member at 5+ WIP is context-switching too much and slowing everything down.`,
    });

    // 7. Daily Standup Summary
    seedSkills.push({
      name: "Daily Standup Summary",
      description: "Generate a concise daily standup report covering what was completed, what's in progress, and what's blocked across the team. Use when asked for a standup, daily summary, status update, or TLDR of what the team is working on.",
      category: "reporting",
      tags: ["standup", "daily", "summary", "status"],
      template: `# Daily Standup Summary

When the user asks for a standup or daily summary:

## Data gathering
1. Call \`get_team_workload\` for each member's current work.
2. Call \`get_cycle_stats\` for cycle progress.
3. Call \`query_data\` for recently completed items (last 24h):
   \`SELECT identifier, title, assignee_name, completed_at FROM issues WHERE board_column = 'done' AND completed_at >= datetime('now', '-1 day') ORDER BY completed_at DESC\`
4. Call \`query_data\` for stale items:
   \`SELECT identifier, title, assignee_name, status FROM issues WHERE board_column IN ('in_progress', 'in_review') AND julianday('now') - julianday(updated_at) > 3 ORDER BY updated_at ASC LIMIT 5\`

## Response format

### Completed (last 24h)
Bulleted list: [identifier] title — assignee. If nothing completed, say "No completions in the last 24 hours."

### In Progress
Per-member summary: "**Name** (N items): [ID-1] title, [ID-2] title"
Only show members with active work.

### Blocked / Needs Attention
Any items stale > 3 days or members with WIP > 5. Be specific about what needs action.

### Cycle Pulse
One line: "Cycle [name]: X% complete, Y days remaining, [on track / at risk / behind]."

## Tone
Keep it scannable. This should take < 30 seconds to read. Use bullet points, not paragraphs.`,
    });

    // Insert any skills that don't already exist
    let seeded = 0;
    for (const s of seedSkills) {
      if (!db.getSkillByName(s.name)) {
        db.createSkill({
          id: crypto.randomUUID(),
          ...s,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
        seeded++;
      }
    }
    if (seeded > 0) {
      app.log.info(`Seeded ${seeded} skill(s)`);
    }
  }

  // Team config route — returns tracked members with live status
  app.get("/api/team-config", async () => {
    const wipCounts = db.getWipCountByAssignee();
    const members = db.getMembers();
    const memberByLinearId = new Map(members.map(m => [m.linearUserId, m]));

    const result: TrackedMemberStatus[] = cfg.trackedMembers.map(tm => {
      const dbMember = memberByLinearId.get(tm.linearUserId);
      const wipCount = wipCounts.get(tm.linearUserId) || 0;
      const currentStatus: "green" | "yellow" | "red" = wipCount >= 5 ? "red" : wipCount >= 3 ? "yellow" : "green";

      let topIssue: TrackedMemberStatus["topIssue"] = undefined;
      if (dbMember) {
        const issues = db.getIssuesByAssignee(tm.linearUserId);
        const active = issues.find(i =>
          i.snapshot.boardColumn === "in_progress" || i.snapshot.boardColumn === "in_review"
        );
        if (active) {
          topIssue = {
            identifier: active.snapshot.identifier,
            title: active.snapshot.title,
            boardColumn: active.snapshot.boardColumn as BoardColumnId,
          };
        }
      }

      return {
        ...tm,
        memberId: dbMember?.id,
        avatarUrl: dbMember?.avatarUrl,
        wipCount,
        currentStatus,
        topIssue,
      };
    });

    return { trackedMembers: result };
  });

  // Enrichment route
  app.post("/api/enrich/:issueId", async (request, reply) => {
    const { issueId } = request.params as { issueId: string };
    const issue = db.getIssueById(issueId);
    if (!issue) return reply.status(404).send({ ok: false, error: "Issue not found" });
    const enrichment = await enrichmentService.enrichIssue(issue);
    return { ok: true, enrichment };
  });

  app.post("/api/enrich/batch", async (request, reply) => {
    const body = request.body as { issueIds?: string[] };
    if (!body?.issueIds?.length) return reply.status(400).send({ ok: false, error: "issueIds required" });
    const enrichments = await enrichmentService.enrichBatch(body.issueIds);
    return { ok: true, enrichments };
  });

  // ─── Embedding routes ───
  app.post("/api/embeddings/resync", async (request) => {
    const body = (request.body || {}) as { limit?: number };
    const limit = body.limit || 100;
    const result = await embeddingService.resyncEmbeddings(limit);
    return { ok: true, ...result };
  });

  app.get("/api/embeddings/status", async () => {
    const count = db.getEmbeddingCount();
    return { ok: true, embeddingCount: count };
  });

  app.post("/api/embeddings/search", async (request, reply) => {
    const body = request.body as { query?: string; limit?: number };
    if (!body?.query) return reply.status(400).send({ ok: false, error: "query required" });
    const results = await embeddingService.findSimilar(body.query, body.limit || 5);
    return { ok: true, results };
  });

  // Background sync setup
  let linearSyncRunning = false;
  let githubSyncRunning = false;

  const linearInterval = setInterval(async () => {
    if (!linear.hasKey || linearSyncRunning) return;
    linearSyncRunning = true;
    try { await syncOrchestrator.syncAll("background-linear-sync"); }
    catch (e) { app.log.error({ err: e }, "Background Linear sync failed"); }
    finally { linearSyncRunning = false; }
  }, cfg.backgroundRefreshMs);

  const githubInterval = setInterval(async () => {
    if (!github.isConfigured || githubSyncRunning) return;
    githubSyncRunning = true;
    try { await githubSync.sync(); }
    catch (e) { app.log.error({ err: e }, "Background GitHub sync failed"); }
    finally { githubSyncRunning = false; }
  }, 5 * 60 * 1000); // GitHub every 5 min

  // Initial sync on startup
  syncOrchestrator.syncAll("startup-sync").catch(e => {
    app.log.warn({ err: e }, "Initial sync failed — app still available");
  });

  // Cleanup on close
  app.addHook("onClose", async () => {
    clearInterval(linearInterval);
    clearInterval(githubInterval);
    db.close();
  });

  return app;
};
