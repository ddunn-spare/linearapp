---
phase: 01-approval-infrastructure-flow
plan: 03
subsystem: ui
tags: [approval-card, react, mui, chat-integration, optimistic-update, sse-events, action-lifecycle]

# Dependency graph
requires:
  - phase: 01-01
    provides: ActionProposal types, action_proposals DB, ActionStateMachine, SSE streaming
  - phase: 01-02
    provides: Tool registry, ApprovalManager, approve/decline/retry endpoints, system prompt
provides:
  - ApprovalCard component with 5 lifecycle states (proposed, executing, succeeded, failed, declined)
  - ChatPage integration rendering approval cards inline in assistant messages
  - API client functions for approveAction, declineAction, retryAction, getConversationProposals
  - Approve All shortcut for bulk approval with sequential execution and halt-on-failure
  - Optimistic state updates for responsive UI
  - Proposal persistence across page refresh via conversation-based loading
affects: [02-linear-actions, 03-github-actions]

# Tech tracking
tech-stack:
  added: []
  patterns: [optimistic-ui-update, approval-card-lifecycle-rendering, approve-all-sequential-halt-on-failure]

key-files:
  created:
    - apps/web/src/components/ApprovalCard.tsx
  modified:
    - apps/web/src/api.ts
    - apps/web/src/pages/ChatPage.tsx

key-decisions:
  - "ApprovalCard renders all 5 states in a single component using conditional rendering per ActionState"
  - "onApprove returns Promise<boolean> to support Approve All halt-on-failure pattern"
  - "Optimistic UI updates set executing state before API response, revert to failed on error"
  - "Streaming message ID generated early (before stream starts) to match proposals to current message"

patterns-established:
  - "Approval card lifecycle: proposed (full card) -> executing (spinner) -> succeeded/failed/declined (compact)"
  - "Optimistic action pattern: set state immediately, call API, revert on failure"
  - "Approve All sequential: iterate IDs, await each handleApprove, break on false return"
  - "Proposal-to-message matching: proposals filtered by messageId for inline rendering"

# Metrics
duration: 3min
completed: 2026-02-12
---

# Phase 1 Plan 3: Approval Card UI & Chat Integration Summary

**ApprovalCard component with diff-style previews and 5 lifecycle states, inline chat integration with Approve All bulk shortcut and optimistic state management**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-12T23:02:41Z
- **Completed:** 2026-02-12T23:04:49Z
- **Tasks:** 3 (2 auto + 1 human-verified checkpoint)
- **Files modified:** 3

## Accomplishments
- ApprovalCard component rendering all 5 lifecycle states with smooth MUI Collapse/Fade transitions, diff-style field previews, and double-click prevention
- Full ChatPage integration: proposals state management, SSE event handling for action_proposed/action_update, inline rendering in assistant and streaming messages
- Approve All shortcut appearing for 2+ pending actions, executing sequentially with halt-on-failure behavior
- Optimistic UI updates on approve/decline/retry with error recovery, plus proposal persistence across page refresh
- End-to-end approval flow verified by human: approve, decline, retry, Approve All, refresh persistence, and double-click idempotency all confirmed working

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ApprovalCard component with all lifecycle states** - `2d94505` (feat)
2. **Task 2: Integrate approval cards into ChatPage with full approval flow** - `8bf54f5` (feat)
3. **Task 3: End-to-end approval flow verification** - human-verified (checkpoint)

## Files Created/Modified
- `apps/web/src/components/ApprovalCard.tsx` - ApprovalCard with proposed/executing/succeeded/failed/declined states, diff-style preview fields, MUI Collapse/Fade animations
- `apps/web/src/api.ts` - Added approveAction, declineAction, retryAction, getConversationProposals API functions
- `apps/web/src/pages/ChatPage.tsx` - Proposals state (Map), SSE event handling, inline card rendering in AssistantMessage/StreamingMessage, action handlers with optimistic updates, ApproveAllButton, proposal-to-message matching

## Decisions Made
- ApprovalCard is a single component that conditionally renders based on ActionState, avoiding multiple sub-components for simplicity
- onApprove returns `Promise<boolean>` (true on success) to allow Approve All to halt on failure without reading React state
- Streaming message ID is generated via `crypto.randomUUID()` before streaming begins, enabling proposals to be matched to the current streaming message
- Optimistic updates set executing/declined state immediately on click, then reconcile with server response (or revert to failed on error)
- Approve button disabled immediately via local state (`approveDisabled`) as defense-in-depth alongside backend idempotency

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Human Verification (Task 3)

All 10 verification steps passed:
1. Approval card appears inline in agent message with diff-style preview
2. Approve button is filled/primary, Decline is text/secondary
3. Approve triggers spinner + "Executing...", then collapses to compact success with link
4. State persists across page refresh
5. Decline shows muted compact state, agent acknowledges naturally
6. Multiple actions show individual cards with Approve All shortcut
7. Approve All executes sequentially
8. Double-click produces only one execution (idempotency confirmed)

## Next Phase Readiness
- Phase 1 complete: all approval infrastructure and UI verified end-to-end
- Phase 2 (Linear actions) can register real write tools and they will automatically appear as approval cards
- The full pipeline works: agent proposes -> user sees card -> approve/decline -> action executes -> result displayed

## Self-Check: PASSED

All 3 created/modified files verified on disk. Both task commits verified in git history (2d94505, 8bf54f5).

---
*Phase: 01-approval-infrastructure-flow*
*Completed: 2026-02-12*
