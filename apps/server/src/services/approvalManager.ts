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

      if (parsed.error && !parsed.partialSuccess) {
        log.warn("Tool returned error", { proposalId, error: parsed.error });
        return this.stateMachine.markFailed(proposalId, String(parsed.error));
      }

      // Build a summary string and extract URL if present
      const summary = this.buildResultSummary(proposal.toolName, parsed);
      const resultUrl = parsed.url || parsed.resultUrl || undefined;

      // Partial success: the action ran but had mixed results. Mark as succeeded
      // with a result string that clearly indicates partial success.
      if (parsed.partialSuccess) {
        log.info("Execution partially succeeded", { proposalId, summary });
        return this.stateMachine.markSucceeded(proposalId, summary, resultUrl);
      }

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
      case "create_issue": {
        const title = String(args.title || "Untitled");
        const parts: string[] = [];
        if (args.priority !== undefined && args.priority !== null) {
          const labels = ["None", "Urgent", "High", "Medium", "Low"];
          parts.push(labels[Number(args.priority)] || "None");
        }
        if (args.assigneeName) parts.push(`Assignee: ${String(args.assigneeName)}`);
        const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
        return `Create issue: ${title}${suffix}`;
      }
      case "update_issue": {
        const identifier = String(args.issueId || "unknown");
        const changedFields: string[] = [];
        if (args.title !== undefined && args.title !== null) changedFields.push("title");
        if (args.description !== undefined && args.description !== null) changedFields.push("description");
        if (args.priority !== undefined && args.priority !== null) changedFields.push("priority");
        if (args.assigneeName !== undefined && args.assigneeName !== null) changedFields.push("assignee");
        if (args.status !== undefined && args.status !== null) changedFields.push("status");
        if (args.labelNames && Array.isArray(args.labelNames) && args.labelNames.length > 0) changedFields.push("labels");
        if (args.projectName !== undefined && args.projectName !== null) changedFields.push("project");
        const fieldList = changedFields.length > 0 ? changedFields.join(", ") : "fields";
        return `Update ${identifier}: ${fieldList}`;
      }
      case "delete_issue": {
        const identifier = String(args.issueId || "unknown");
        return `Delete issue: ${identifier}`;
      }
      case "add_comment": {
        const identifier = String(args.issueId || "unknown");
        const body = String(args.body || "");
        const truncated = body.length > 80 ? body.slice(0, 80) + "..." : body;
        return `Comment on ${identifier}: ${truncated}`;
      }
      case "manage_project": {
        const action = String(args.action || "create");
        const name = String(args.projectName || "unknown");
        if (action === "create") return `Create project: ${name}`;
        if (action === "archive") return `Archive project: ${name}`;
        return `Update project: ${name}`;
      }
      case "manage_cycle": {
        const action = String(args.action || "add_issue");
        const identifier = String(args.issueId || "unknown");
        const cycleName = args.cycleName ? String(args.cycleName) : "active cycle";
        if (action === "add_issue") return `Add ${identifier} to cycle ${cycleName}`;
        return `Remove ${identifier} from cycle`;
      }
      case "manage_labels": {
        const action = String(args.action || "create");
        const labelName = String(args.labelName || "unknown");
        const identifier = args.issueId ? String(args.issueId) : undefined;
        if (action === "create") return `Create label: ${labelName}`;
        if (action === "add_to_issue") return `Add label '${labelName}' to ${identifier || "unknown"}`;
        return `Remove label '${labelName}' from ${identifier || "unknown"}`;
      }
      case "bulk_update_issues": {
        const issueIds = Array.isArray(args.issueIds) ? args.issueIds : [];
        const n = issueIds.length;
        const updates = (args.updates || {}) as Record<string, unknown>;
        const parts: string[] = [];
        if (updates.priority !== undefined && updates.priority !== null) {
          const labels = ["None", "Urgent", "High", "Medium", "Low"];
          parts.push(`set priority to ${labels[Number(updates.priority)] || "None"}`);
        }
        if (updates.assigneeName) parts.push(`assign to ${String(updates.assigneeName)}`);
        if (updates.status) parts.push(`set status to ${String(updates.status)}`);
        if (updates.labelNames && Array.isArray(updates.labelNames) && updates.labelNames.length > 0) {
          parts.push(`set labels`);
        }
        if (updates.projectName) parts.push(`set project to ${String(updates.projectName)}`);
        const fieldSummary = parts.length > 0 ? parts.join(", ") : "update fields";
        const largeBatch = n > 10 ? " (large batch)" : "";
        return `Update ${n} issues: ${fieldSummary}${largeBatch}`;
      }
      case "create_okr": {
        const objective = String(args.objective || "Untitled");
        const quarter = String(args.quarter || "");
        return `Create OKR: ${objective} (${quarter})`;
      }
      case "update_okr": {
        const okrId = String(args.okrId || "unknown");
        const changedFields: string[] = [];
        if (args.objective !== undefined && args.objective !== null) changedFields.push("objective");
        if (args.quarter !== undefined && args.quarter !== null) changedFields.push("quarter");
        if (args.owner !== undefined && args.owner !== null) changedFields.push("owner");
        if (args.status !== undefined && args.status !== null) changedFields.push("status");
        if (args.keyResults && Array.isArray(args.keyResults)) changedFields.push("key results");
        const fieldList = changedFields.length > 0 ? changedFields.join(", ") : "fields";
        // Use objective if provided, otherwise fall back to okrId
        const label = (args.objective !== undefined && args.objective !== null) ? String(args.objective) : okrId;
        return `Update OKR: ${label} -- ${fieldList}`;
      }
      case "delete_okr": {
        // Try to use objective from args context; the preview already fetches it from db
        const okrId = String(args.okrId || "unknown");
        return `Delete OKR: ${okrId}`;
      }
      case "update_key_result": {
        const currentValue = args.currentValue !== undefined ? String(args.currentValue) : "unknown";
        return `Update key result progress: ${currentValue}`;
      }
      case "link_issue_to_kr": {
        const identifier = String(args.issueId || "unknown");
        const action = String(args.action || "link");
        if (action === "unlink") return `Unlink ${identifier} from key result`;
        return `Link ${identifier} to key result`;
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
      case "create_issue":
        return `Created ${parsed.identifier || parsed.issueId || "unknown"}: ${parsed.title || ""}`;
      case "update_issue":
        return `Updated ${parsed.identifier || parsed.issueId || "unknown"}`;
      case "delete_issue":
        return `Deleted ${parsed.identifier || "unknown"}`;
      case "add_comment":
        return `Comment added to ${parsed.issueIdentifier || "unknown"}`;
      case "manage_project": {
        const name = parsed.name || parsed.projectName || "unknown";
        if (parsed.projectId) return `Created project: ${name}`;
        return `Updated project: ${name}`;
      }
      case "manage_cycle": {
        const identifier = parsed.issueIdentifier || "unknown";
        if (parsed.cycleName) return `Added ${identifier} to cycle ${parsed.cycleName}`;
        return `Removed ${identifier} from cycle`;
      }
      case "manage_labels": {
        const labelName = parsed.labelName || "unknown";
        if (parsed.labelId) return `Created label: ${labelName}`;
        const identifier = parsed.issueIdentifier || "unknown";
        return `Label '${labelName}' updated on ${identifier}`;
      }
      case "bulk_update_issues": {
        if (parsed.partialSuccess) {
          return `Updated ${parsed.updatedCount}/${parsed.totalCount} issues (${parsed.failedCount} failed)`;
        }
        if (parsed.success === false) {
          return `All updates failed`;
        }
        return `Updated ${parsed.updatedCount || 0} issues successfully`;
      }
      case "create_okr":
        return `Created OKR: ${parsed.objective || "unknown"}`;
      case "update_okr":
        return `Updated OKR: ${parsed.objective || "unknown"}`;
      case "delete_okr":
        return `Deleted OKR: ${parsed.objective || "unknown"}`;
      case "update_key_result":
        return `Key result progress updated to ${parsed.currentValue ?? "unknown"}`;
      case "link_issue_to_kr": {
        const action = String(parsed.action || "link");
        const identifier = parsed.issueIdentifier || "unknown";
        if (action === "unlink") return `Issue ${identifier} unlinked from key result`;
        return `Issue ${identifier} linked to key result`;
      }
      default:
        return parsed.success ? "Action completed successfully" : JSON.stringify(parsed).slice(0, 200);
    }
  }
}
