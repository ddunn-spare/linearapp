import type { ActionProposal, ActionCategory, ActionPreviewField, ActionState } from "@linearapp/shared";
import type { StateDb } from "../db";
import { createLogger } from "../lib/logger";

const log = createLogger("ActionStateMachine");

/** Valid transitions: from state -> allowed next states */
const VALID_TRANSITIONS: Record<ActionState, ActionState[]> = {
  proposed: ["approved", "declined"],
  approved: ["executing"],
  executing: ["succeeded", "failed"],
  failed: ["executing"], // retry
  succeeded: [],         // terminal
  declined: [],          // terminal
};

export class ActionStateMachine {
  constructor(private readonly db: StateDb) {}

  createProposal(params: {
    conversationId: string;
    messageId: string;
    toolName: string;
    toolArguments: Record<string, unknown>;
    description: string;
    preview: ActionPreviewField[];
    category?: ActionCategory;
  }): ActionProposal {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const idempotencyKey = `${params.conversationId}:${params.toolName}:${JSON.stringify(params.toolArguments)}:${Date.now()}`;

    const proposal: ActionProposal = {
      id,
      conversationId: params.conversationId,
      messageId: params.messageId,
      toolName: params.toolName,
      toolArguments: params.toolArguments,
      description: params.description,
      preview: params.preview,
      state: "proposed",
      category: params.category,
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };

    this.db.createActionProposal(proposal);
    log.info("Created proposal", { id, toolName: params.toolName, conversationId: params.conversationId });
    return proposal;
  }

  approve(proposalId: string): ActionProposal {
    return this.transition(proposalId, ["proposed"], "approved");
  }

  decline(proposalId: string): ActionProposal {
    return this.transition(proposalId, ["proposed"], "declined");
  }

  markExecuting(proposalId: string): ActionProposal {
    const proposal = this.db.getActionProposal(proposalId);
    if (!proposal) {
      throw new Error(`Action proposal not found: ${proposalId}`);
    }

    // Idempotency guard: if already executing or succeeded, return as-is (handles double-click)
    if (proposal.state === "executing" || proposal.state === "succeeded") {
      log.info("Idempotent markExecuting — already in state", { proposalId, state: proposal.state });
      return proposal;
    }

    // Allow transition from approved or failed (retry)
    return this.transition(proposalId, ["approved", "failed"], "executing");
  }

  markSucceeded(proposalId: string, result: string, resultUrl?: string): ActionProposal {
    return this.transition(proposalId, ["executing"], "succeeded", { result, resultUrl });
  }

  markFailed(proposalId: string, error: string): ActionProposal {
    return this.transition(proposalId, ["executing"], "failed", { error });
  }

  getProposal(proposalId: string): ActionProposal | null {
    return this.db.getActionProposal(proposalId);
  }

  getProposalsByMessage(messageId: string): ActionProposal[] {
    return this.db.getActionProposalsByMessage(messageId);
  }

  private transition(
    proposalId: string,
    expectedStates: ActionState[],
    newState: ActionState,
    updates?: { result?: string; resultUrl?: string; error?: string },
  ): ActionProposal {
    const proposal = this.db.getActionProposal(proposalId);
    if (!proposal) {
      throw new Error(`Action proposal not found: ${proposalId}`);
    }

    if (!expectedStates.includes(proposal.state)) {
      throw new Error(
        `Cannot transition action from '${proposal.state}' to '${newState}'. ` +
        `Expected current state to be one of: ${expectedStates.join(", ")}`,
      );
    }

    // Verify the transition is valid per the state machine rules
    const allowed = VALID_TRANSITIONS[proposal.state];
    if (!allowed || !allowed.includes(newState)) {
      throw new Error(
        `Invalid state transition: '${proposal.state}' -> '${newState}'. ` +
        `Allowed transitions from '${proposal.state}': ${allowed?.join(", ") || "none (terminal state)"}`,
      );
    }

    this.db.updateActionState(proposalId, newState, updates);
    log.info("State transition", { proposalId, from: proposal.state, to: newState });

    // Return the updated proposal
    const updated = this.db.getActionProposal(proposalId);
    if (!updated) {
      throw new Error(`Failed to reload proposal after update: ${proposalId}`);
    }
    return updated;
  }
}
