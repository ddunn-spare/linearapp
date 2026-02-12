# Phase 1: Approval Infrastructure & Flow - Context

**Gathered:** 2026-02-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can see, approve, and decline agent-proposed write actions with clear feedback at every lifecycle stage. This phase delivers the approval UX layer (cards, state transitions, execution feedback) and the underlying infrastructure (state machine, SSE streaming, idempotency). It does NOT include any specific write actions (Linear, GitHub, etc.) — those come in later phases.

</domain>

<decisions>
## Implementation Decisions

### Approval card design
- Full diff-style detail — show exactly what will change, field by field, like a data diff
- Cards appear inline within the agent's chat message, not as separate elements below
- Visually distinct card — bordered container with background color, clearly stands out as an action proposal
- Approve button is primary (filled/colored), Decline is secondary (outline/text) — nudges toward action

### Lifecycle feedback
- When executing: card transforms in-place — buttons replaced with spinner and "Executing..." text
- On success: card collapses to compact confirmation, single line like "Issue created: FIX-123" with link to result
- Resolved cards become read-only — buttons disappear, card is a static record of what happened
- Smooth transitions between states (pending → executing → done) — subtle animations, fade/morph

### Decline & failure UX
- On decline: agent acknowledges and moves on naturally ("Got it, skipping that"), no follow-up questions
- On failure: card shows red/error state with plain-language explanation of what went wrong (no separate agent message)
- Failed cards show a "Retry" button that re-executes the same action without requiring fresh approval
- No undo in Phase 1 — keep it simple, user can ask the agent to reverse things manually

### Multi-action handling
- Multiple actions in one response get individual cards — each approved/declined independently
- "Approve All" shortcut appears when 2+ actions are pending, for bulk operation convenience
- Approved actions execute sequentially, one at a time
- If one action fails mid-sequence: halt execution, keep remaining actions pending, let user decide whether to continue

### Claude's Discretion
- SSE streaming architecture and event format
- State machine implementation details
- Exact card component structure and CSS
- Loading skeleton / shimmer treatment
- Idempotency key strategy
- System prompt auto-generation approach

</decisions>

<specifics>
## Specific Ideas

No specific references — open to standard approaches. Key emphasis: the card should feel like a first-class UI element, not a bolted-on chat widget. The diff-style preview is central to building user trust in the approval flow.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-approval-infrastructure-flow*
*Context gathered: 2026-02-12*
