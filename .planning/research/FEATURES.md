# Feature Research

**Domain:** AI chat with action execution and approval flows (engineering management tool)
**Researched:** 2026-02-12
**Confidence:** MEDIUM-HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Approval card before write actions** | Every agentic product (Copilot, Cline, Notion AI) requires confirmation before executing write operations. Users will not trust a system that modifies their Linear issues, GitHub PRs, or OKRs without asking first. | MEDIUM | Card must show: what will change, current vs proposed values, approve/deny buttons. Vercel AI SDK has a `needsApproval` pattern that pauses tool execution and renders approval UI. |
| **Action success/failure feedback** | Users need to know what happened after they approved. A silent approval with no feedback creates anxiety. Carbon Design System and all major design systems treat inline status feedback as mandatory for any state-changing operation. | LOW | Inline in the chat thread, not toasts. Show the completed action with a success indicator, or the error with what went wrong. Must appear at the location of the approval card, not in a separate notification area. |
| **Clear action preview (intent preview)** | Smashing Magazine's 2026 agentic UX research identifies "Intent Preview" as pattern #1. Users must see a plain-language summary of what will happen before approving. Raw JSON or vague descriptions destroy trust. | MEDIUM | "Create issue 'Fix login bug' in project Backend, priority High, assigned to @devon" -- not "Execute createIssue with params..." |
| **Error messages with recovery path** | When an action fails (permissions, API errors, invalid state), users need to know what went wrong AND what to do next. "Something went wrong" is unacceptable. Research shows recovery paths (retry, modify, escalate) are expected in all agentic systems. | LOW | Pattern: acknowledge error, explain what happened in plain language, offer retry or alternative. "I couldn't assign this issue -- Devon doesn't have access to Project X. Want me to assign to someone else?" |
| **Action state indicators** | Users need to see whether an action is pending approval, executing, succeeded, or failed. Without visible state, users click approve and see nothing happen for 2 seconds, then panic-click again. | LOW | States: pending-approval, executing (with spinner), succeeded, failed, undone. Visual indicators for each. |
| **Single-action confirmation** | The simplest case: AI proposes one action, user approves or denies. This is the boolean confirmation pattern identified across Permit.io, Cloudflare, and Vercel AI SDK research. Must be frictionless -- one click. | LOW | Approve and Deny buttons. Approve executes immediately. Deny tells the AI to try a different approach or ask for clarification. |
| **Capability disclosure** | Users must know what the AI can do. "What can you do?" is the most common first message to any AI assistant. Without an answer, users default to treating it as a search box. Notion, ClickUp, and GitHub Copilot all surface capabilities prominently. | MEDIUM | Info button showing categorized capabilities (what I can read, what I can create/modify, what I can search). Also contextual suggestions when the user seems stuck. |
| **Contextual action suggestions** | After completing a read action (e.g., showing issue details), suggest relevant write actions ("Want me to update the priority?" or "Should I reassign this?"). Without this, users don't know write actions exist even when they have them. | MEDIUM | Suggestions appear as clickable chips or buttons below the response. Not every response -- only when a natural follow-up action exists. |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Multi-action plan preview** | When a user says "Create a sprint with these 5 issues and assign the team," show the full plan as a numbered list of actions with a single "Execute All" button, not 5 separate approval cards. Notion AI agents do 20+ minute multi-step plans. This is where most competitors are weak -- GitHub Copilot still asks per-action. | HIGH | Plan shows all actions in sequence with dependencies. User can approve all, deny all, or edit individual items before execution. This is the "Delegate" intent from the "8 Core User Intents" framework -- users want to delegate, not micro-manage. |
| **Undo/rollback for executed actions** | Smashing Magazine's research calls this "Action Audit & Undo" -- a time-limited undo window with prominent undo buttons for every reversible action. Creates psychological safety that encourages delegation. Most project management AI tools do NOT offer undo today. | HIGH | Not all actions are reversible (can't un-send a notification). Show undo button only for reversible actions. Time-limited window (e.g., 30 seconds for simple actions). Under the hood: store the previous state and reverse the API call. |
| **Progressive trust / autonomy dial** | Let users configure which actions require approval vs. auto-execute. Start everything at "confirm first," let users graduate low-risk actions to auto-execute. Smashing Magazine identifies this as pattern #2. Microsoft and Cloudflare both document this pattern. Very few products implement it well today. | HIGH | Per-action-type settings: "Always ask" / "Auto-execute" / "Never allow." Start conservative. Track setting churn as a trust signal. Example: user might auto-approve "add label" but always want confirmation for "delete issue." |
| **Inline edit before approve** | Instead of just approve/deny, let users modify the proposed action before approving. The "Request for Confirmation" (ROC) pattern from the approval framework research. Example: AI proposes creating an issue with priority Medium, user clicks to change it to High, then approves. | MEDIUM | Editable fields in the approval card. Not a full form -- just the key fields the AI proposed values for. Reduces the deny-and-rephrase cycle significantly. |
| **Bulk operation preview with dry run** | For operations like "Update all bugs in Sprint 12 to High priority," show a preview of every item that would be affected before executing. The "simulation pre-flight" pattern from agentic workflow research. | HIGH | Show a scrollable list of items with before/after values. "This will update 23 issues. [Preview] [Execute] [Cancel]." Prevents accidental workspace-wide changes -- a critical safety concern identified in bulk operation research. |
| **Action audit trail** | Persistent log of everything the AI has done, accessible from the chat or a dedicated view. Shows what, when, result, and who approved. Smashing Magazine lists this as foundational infrastructure (Phase 1). | MEDIUM | Chronological list with filters. Each entry: action type, target, timestamp, status (succeeded/failed/undone), who approved. Useful for managers reviewing what happened and for debugging. |
| **Cross-tool action chaining** | "Create a Linear issue for this GitHub PR review feedback and link them" -- actions that span Linear + GitHub in a single flow. This is where the engineering management context creates unique value no horizontal AI tool can match. | HIGH | Requires the AI to understand relationships across tools. Must show the full plan spanning tools with clear indicators of which system each action targets. |
| **Confidence signals on proposed actions** | When the AI is uncertain about a parameter (e.g., which project to put an issue in), surface that uncertainty visually. Smashing Magazine's pattern #4. Prevents automation bias. | LOW | Visual indicator (e.g., "I'm guessing this goes in Project Backend -- is that right?" vs confidently stating it). Drives user attention to the parts that need scrutiny. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Auto-execute all actions without approval** | "I trust the AI, just do it" -- power users want speed. | A single hallucinated action (wrong issue deleted, wrong person assigned, wrong project) destroys trust permanently. Research unanimously warns against removing approval for destructive actions. GitHub Copilot explicitly prevents auto-approval of its own PRs for security reasons. | Progressive autonomy dial (differentiator above). Let users opt in to auto-execute for specific LOW-risk action types. Never auto-execute deletes, bulk ops, or cross-tool actions. |
| **Autonomous background agents** | "Have the AI watch for new issues and auto-triage them." Notion and ClickUp offer scheduled/trigger-based agents. | Fundamentally different product (background automation) vs. the chat-with-approval model. Background agents need their own monitoring, error handling, and rollback infrastructure. Mixing them into a chat UX creates confusion about what's happening and when. | Build action execution in chat first. Background automation is a separate milestone with its own research. If needed, expose it as a separate "Automations" feature, not in the chat thread. |
| **Natural language to arbitrary API call** | "Let me tell the AI to do anything the API supports." | Unbounded action space makes approval UX impossible -- you can't preview what you don't understand. Creates security risks and unpredictable behavior. Every successful agentic product constrains its action space to a defined tool set. | Curated, well-defined action set with clear descriptions. Add new actions deliberately based on user demand. Better to do 30 actions well than 300 poorly. |
| **Real-time collaborative approval** | "Multiple team members should be able to see and approve actions in a shared chat." | Massively increases complexity: who has approval authority? What happens with conflicting decisions? Race conditions on actions. Cloudflare's multi-approver pattern is designed for async workflows, not real-time chat. | Single-user approval in chat. For team workflows needing multi-approval, that's a separate feature (and likely belongs in a workflow/automation layer, not inline chat). |
| **Voice/multimodal action execution** | "Let me speak to approve actions." | Voice confirmation is error-prone ("yes" in conversation != approval). Multimodal adds huge complexity for marginal value in an engineering management context where users are at keyboards. | Keyboard shortcuts for approve/deny (Enter to approve, Esc to deny). Much faster than voice for power users at their desks. |
| **Approval via external channels (Slack/email)** | "Notify me in Slack when the AI needs approval." | Splits context: user must remember what they asked, switch tools, lose the conversation thread. The Cloudflare research shows this works for async workflows with long timeouts (days), not for interactive chat where the user is present. | Keep approval in the chat where context lives. If the user leaves, the pending action waits. No external notification needed for interactive sessions. |

## Feature Dependencies

```
[Approval Card UI]
    |-- requires --> [Action State Indicators]
    |-- requires --> [Action Success/Failure Feedback]
    |-- requires --> [Clear Action Preview]
    |
    |-- enables --> [Single-Action Confirmation]
    |                   |-- enables --> [Multi-Action Plan Preview]
    |                   |-- enables --> [Inline Edit Before Approve]
    |
    |-- enables --> [Error Messages with Recovery Path]

[Capability Disclosure]
    |-- enhances --> [Contextual Action Suggestions]

[Single-Action Confirmation]
    |-- enables --> [Undo/Rollback]
    |-- enables --> [Action Audit Trail]
    |-- enables --> [Progressive Trust / Autonomy Dial]

[Multi-Action Plan Preview]
    |-- requires --> [Single-Action Confirmation] (must work for individual actions first)
    |-- enables --> [Bulk Operation Preview with Dry Run]
    |-- enables --> [Cross-Tool Action Chaining]

[Action Audit Trail]
    |-- requires --> [Action Success/Failure Feedback] (needs execution records)
    |-- enhances --> [Undo/Rollback] (audit trail shows what can be undone)

[Confidence Signals]
    |-- enhances --> [Clear Action Preview]
    |-- enhances --> [Inline Edit Before Approve]
```

### Dependency Notes

- **Approval Card UI requires State Indicators:** The card itself needs states (pending, executing, done, failed). Build the state machine first.
- **Multi-Action Plan requires Single-Action:** You cannot safely execute a plan of 5 actions if you haven't proven single-action approval works. Ship single first, then compose.
- **Undo requires Single-Action Confirmation:** You need to know what was executed to undo it. The execution record from single-action confirmation feeds the undo system.
- **Progressive Trust requires Audit Trail:** You cannot safely auto-execute actions unless you have a record of what happened. Audit trail is the safety net that makes autonomy acceptable.
- **Bulk Dry Run requires Multi-Action Plan:** Dry run is a specialization of multi-action preview for cases where the action set is generated (not user-specified).

## MVP Definition

### Launch With (v1)

Minimum viable product -- what's needed to validate the concept.

- [ ] **Approval card with approve/deny** -- The core interaction. Without this, there is no action execution feature.
- [ ] **Clear action preview in plain language** -- Users must understand what they're approving. Non-negotiable for trust.
- [ ] **Action state indicators** (pending, executing, succeeded, failed) -- Visual feedback for the entire lifecycle.
- [ ] **Success/failure feedback inline** -- Users must see the result. "Done" with a checkmark, or "Failed" with an explanation.
- [ ] **Error messages with recovery paths** -- When things break, users need a next step, not a dead end.
- [ ] **Capability disclosure (info button)** -- Users must be able to discover what actions exist. Without this, adoption stalls.
- [ ] **Contextual action suggestions** -- After read results, nudge users toward write actions. Drives feature discovery.

### Add After Validation (v1.x)

Features to add once core is working and users are executing actions.

- [ ] **Inline edit before approve** -- Add when user feedback shows frequent deny-and-rephrase cycles (signal: deny rate > 20%).
- [ ] **Multi-action plan preview** -- Add when users request batch operations or multi-step workflows.
- [ ] **Confidence signals** -- Add when AI accuracy data shows users are blindly approving incorrect actions (automation bias).
- [ ] **Action audit trail** -- Add when users ask "what did the AI do?" or when managers need oversight.

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Undo/rollback** -- Requires significant backend infrastructure to store pre-action state and reverse API calls. High value but high cost. Build after action execution is proven.
- [ ] **Progressive trust / autonomy dial** -- Requires enough usage data to know which actions are safe to auto-execute. Premature optimization if launched too early.
- [ ] **Bulk operation preview with dry run** -- Requires multi-action plan preview to exist first. Niche use case until bulk operations are common.
- [ ] **Cross-tool action chaining** -- Requires both Linear and GitHub actions to be individually solid. Don't chain unreliable primitives.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Approval card (approve/deny) | HIGH | MEDIUM | P1 |
| Clear action preview | HIGH | LOW | P1 |
| Action state indicators | HIGH | LOW | P1 |
| Success/failure feedback | HIGH | LOW | P1 |
| Error messages with recovery | HIGH | LOW | P1 |
| Capability disclosure | HIGH | MEDIUM | P1 |
| Contextual action suggestions | MEDIUM | MEDIUM | P1 |
| Inline edit before approve | MEDIUM | MEDIUM | P2 |
| Multi-action plan preview | HIGH | HIGH | P2 |
| Confidence signals | MEDIUM | LOW | P2 |
| Action audit trail | MEDIUM | MEDIUM | P2 |
| Undo/rollback | HIGH | HIGH | P3 |
| Progressive trust / autonomy dial | MEDIUM | HIGH | P3 |
| Bulk dry run preview | MEDIUM | HIGH | P3 |
| Cross-tool action chaining | HIGH | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Notion AI Agents | GitHub Copilot (Agent) | Jira AI (Rovo) | ClickUp Brain | Our Approach |
|---------|-----------------|----------------------|----------------|---------------|--------------|
| Action execution | Yes -- autonomous, up to 20 min multi-step | Yes -- code changes via PR, needs manual workflow approval | Limited -- triage, content generation, field updates | Yes -- automations, task creation | Inline chat with approval cards. More interactive than Notion's "fire and forget," more scoped than Copilot's PR model. |
| Approval flow | Minimal -- trigger-based, not inline approval | Per-PR approval (workflow approval required before merge) | No explicit approval -- actions are suggestions | No explicit approval -- automation-based | Explicit inline approval cards with approve/deny/edit. Our key differentiator over all competitors. |
| Undo | Version history on pages/databases | Git revert on PRs | No | No | Future -- store pre-action state for reversible actions. |
| Capability discovery | Agent descriptions in setup | Slash commands, model picker | Feature-specific AI buttons throughout UI | Brain button in context | Info button with categorized capability list + contextual suggestions. |
| Bulk operations | Yes -- "hundreds of pages at once" | No -- one PR at a time | Limited -- automation rules on query results | Yes -- via automations | Planned for v2 with dry-run preview. |
| Multi-tool chaining | Yes -- pulls from Slack, Google Drive, etc. | Limited to code + GitHub | Within Atlassian ecosystem only | Within ClickUp only | Cross Linear + GitHub + internal OKRs. Unique value proposition for engineering management. |
| Error recovery | Re-run agent, version rollback | Fix code, re-push | No specific pattern | Re-run automation | Inline error with plain-language explanation + retry/modify options. |
| Trust calibration | No -- either run or don't | Terminal allow-list for safe commands | No | No | Progressive trust (v2+) with per-action-type autonomy settings. |

## Sources

- [Smashing Magazine: Designing for Agentic AI - Practical UX Patterns (2026)](https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/) -- PRIMARY source for pattern taxonomy (Intent Preview, Autonomy Dial, Action Audit, Confidence Signals, Escalation Pathway). HIGH confidence.
- [Vercel AI SDK: Human-in-the-Loop Cookbook](https://ai-sdk.dev/cookbook/next/human-in-the-loop) -- Technical implementation reference for approval states and `needsApproval` pattern. HIGH confidence.
- [Cloudflare Agents: Human-in-the-Loop Guide](https://developers.cloudflare.com/agents/guides/human-in-the-loop/) -- Workflow approval patterns, durable pausing, multi-approver, timeout handling. HIGH confidence.
- [Awesome Agentic Patterns: Human-in-Loop Approval Framework](https://github.com/nibzard/awesome-agentic-patterns/blob/main/patterns/human-in-loop-approval-framework.md) -- Risk classification tiers, what requires approval vs. bypasses it. MEDIUM confidence.
- [UX Magazine: Secrets of Agentic UX](https://uxmag.com/articles/secrets-of-agentic-ux-emerging-design-patterns-for-human-interaction-with-ai-agents) -- Progressive hypothesis formation, approval controls, transparent reasoning. MEDIUM confidence.
- [Permit.io: Human-in-the-Loop Best Practices](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo) -- Policy-driven approval, risk-based conditions, framework recommendations. MEDIUM confidence.
- [Google A2UI: Agent-to-Agent UI](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/) -- Generated UI for agent responses, form-based interactions. LOW confidence (early-stage project).
- [Notion 3.0 Release](https://www.notion.com/releases/2025-09-18) -- Competitor reference for autonomous agent capabilities. HIGH confidence.
- [GitHub Copilot Agent Docs](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent) -- Competitor reference for action execution via PRs. HIGH confidence.
- [Atlassian Rovo AI in Jira](https://www.atlassian.com/software/jira/ai) -- Competitor reference for PM tool AI capabilities. MEDIUM confidence.
- [Carbon Design System: Notification Patterns](https://carbondesignsystem.com/patterns/notification-pattern/) -- Design system reference for inline vs. toast feedback. HIGH confidence.
- ["Beyond Chat: 8 Core User Intents" by Taras Bakusevych (2026)](https://taras-bakusevych.medium.com/beyond-chat-8-core-user-intents-driving-ai-interaction-4f573685938a) -- Framework for Delegate and Oversee intents relevant to action execution. MEDIUM confidence (single source, not verified).

---
*Feature research for: AI chat with action execution and approval flows*
*Researched: 2026-02-12*
