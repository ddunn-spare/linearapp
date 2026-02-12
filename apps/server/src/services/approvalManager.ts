import type { ActionProposal, ActionPreviewField } from "@linearapp/shared";
import type { ActionStateMachine } from "./actionStateMachine";
import type { ToolHandler } from "../tools/index";
import type { StateDb } from "../db";
import { generatePreviewForTool } from "../tools/index";
import { createLogger } from "../lib/logger";

const log = createLogger("ApprovalManager");

export class ApprovalManager {
  constructor(
    private readonly stateMachine: ActionStateMachine,
    private readonly toolHandlers: Record<string, ToolHandler>,
    private readonly db: StateDb,
  ) {}

  /**
   * Create a proposal for a write tool call. The tool is NOT executed --
   * instead, a proposal is created for user review.
   */
  createProposal(params: {
    conversationId: string;
    messageId: string;
    toolName: string;
    toolArguments: Record<string, unknown>;
  }): ActionProposal {
    const preview = generatePreviewForTool(params.toolName, params.toolArguments);
    const description = this.buildDescription(params.toolName, params.toolArguments, preview);

    const proposal = this.stateMachine.createProposal({
      conversationId: params.conversationId,
      messageId: params.messageId,
      toolName: params.toolName,
      toolArguments: params.toolArguments,
      description,
      preview,
    });

    log.info("Created proposal", { id: proposal.id, toolName: params.toolName });
    return proposal;
  }

  /**
   * Approve a proposed action (transitions proposed -> approved).
   * Does NOT execute -- call execute() separately.
   */
  async approve(proposalId: string): Promise<ActionProposal> {
    const approved = this.stateMachine.approve(proposalId);
    log.info("Approved proposal", { proposalId });
    return approved;
  }

  /**
   * Execute an approved (or failed-retry) action.
   * markExecuting is the idempotency gate (INFRA-05): if already executing/succeeded,
   * returns existing proposal without re-executing.
   */
  async execute(proposalId: string): Promise<ActionProposal> {
    const proposal = this.stateMachine.markExecuting(proposalId);

    // Idempotency: if already succeeded, return as-is
    if (proposal.state === "succeeded") {
      log.info("Execute skipped -- already succeeded", { proposalId });
      return proposal;
    }

    const handler = this.toolHandlers[proposal.toolName];
    if (!handler) {
      const error = `Tool handler not found: ${proposal.toolName}`;
      log.error(error, { proposalId });
      return this.stateMachine.markFailed(proposalId, error);
    }

    try {
      const resultStr = await handler(proposal.toolArguments);
      const parsed = JSON.parse(resultStr);

      if (parsed.error) {
        log.warn("Tool returned error", { proposalId, error: parsed.error });
        return this.stateMachine.markFailed(proposalId, String(parsed.error));
      }

      // Build a summary string and extract URL if present
      const summary = this.buildResultSummary(proposal.toolName, parsed);
      const resultUrl = parsed.url || parsed.resultUrl || undefined;

      log.info("Execution succeeded", { proposalId, summary });
      return this.stateMachine.markSucceeded(proposalId, summary, resultUrl);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Execution failed";
      log.error("Execution failed", { proposalId, error: msg });
      return this.stateMachine.markFailed(proposalId, msg);
    }
  }

  /**
   * Decline a proposed action (transitions proposed -> declined).
   */
  async decline(proposalId: string): Promise<ActionProposal> {
    const declined = this.stateMachine.decline(proposalId);
    log.info("Declined proposal", { proposalId });
    return declined;
  }

  /**
   * Retry a failed action. Only failed actions can be retried.
   * Re-executes via execute() which handles the failed -> executing transition.
   */
  async retry(proposalId: string): Promise<ActionProposal> {
    const proposal = this.stateMachine.getProposal(proposalId);
    if (!proposal) {
      throw new Error(`Action proposal not found: ${proposalId}`);
    }
    if (proposal.state !== "failed") {
      throw new Error(`Cannot retry action in state '${proposal.state}' -- only failed actions can be retried`);
    }
    log.info("Retrying failed proposal", { proposalId });
    return this.execute(proposalId);
  }

  /**
   * Get a single proposal by ID.
   */
  getProposal(proposalId: string): ActionProposal | null {
    return this.stateMachine.getProposal(proposalId);
  }

  /**
   * Get all proposals for a conversation (for re-rendering on refresh, INFRA-04).
   */
  getProposalsByConversation(conversationId: string): ActionProposal[] {
    return this.db.getActionProposalsByConversation(conversationId);
  }

  /**
   * Build a human-readable description for a proposal.
   */
  private buildDescription(
    toolName: string,
    args: Record<string, unknown>,
    _preview: ActionPreviewField[],
  ): string {
    switch (toolName) {
      case "demo_create_issue": {
        const title = String(args.title || "Untitled");
        const parts: string[] = [];
        if (args.priority !== undefined) {
          const labels = ["None", "Urgent", "High", "Medium", "Low"];
          parts.push(`Priority: ${labels[Number(args.priority)] || "None"}`);
        }
        if (args.assigneeName) parts.push(`Assignee: ${String(args.assigneeName)}`);
        const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
        return `Create issue: ${title}${suffix}`;
      }
      default:
        return `Execute ${toolName}`;
    }
  }

  /**
   * Build a summary string from tool execution result.
   */
  private buildResultSummary(toolName: string, parsed: Record<string, unknown>): string {
    switch (toolName) {
      case "demo_create_issue":
        return `Issue created: ${parsed.identifier || parsed.issueId || "unknown"}`;
      default:
        return parsed.success ? "Action completed successfully" : JSON.stringify(parsed).slice(0, 200);
    }
  }
}
