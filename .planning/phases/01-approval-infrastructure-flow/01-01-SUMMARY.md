---
phase: 01-approval-infrastructure-flow
plan: 01
subsystem: infra
tags: [action-proposals, state-machine, sse-streaming, sqlite, openai, async-generator]

# Dependency graph
requires: []
provides:
  - ActionProposal, ActionState, ActionPreviewField types in @linearapp/shared
  - action_proposals table with full CRUD in StateDb
  - ActionStateMachine service with idempotency guards
  - ChatStreamEvent variants for action_proposed and action_update
  - True SSE streaming via async generator in ChatService
affects: [01-02, 01-03, 02-linear-actions, 03-github-actions]

# Tech tracking
tech-stack:
  added: []
  patterns: [async-generator-streaming, state-machine-with-idempotency, streaming-tool-call-accumulation]

key-files:
  created:
    - apps/server/src/services/actionStateMachine.ts
  modified:
    - packages/shared/src/index.ts
    - apps/server/src/db.ts
    - apps/server/src/services/chatService.ts
    - apps/server/src/routes/chat.ts

key-decisions:
  - "Idempotency key includes timestamp so same logical action can be proposed in different messages"
  - "markExecuting returns existing proposal if already executing/succeeded (double-click safety)"
  - "Kept deprecated handleMessage() for backward compatibility alongside new handleMessageStream()"
  - "Tool call fragments accumulated from stream chunks using Map<index, {id, name, arguments}> pattern"

patterns-established:
  - "State machine transition validation: VALID_TRANSITIONS map checked before every state change"
  - "Async generator streaming: yield ChatStreamEvents incrementally from OpenAI stream chunks"
  - "Streaming tool call accumulation: fragments arrive incrementally and are assembled before execution"

# Metrics
duration: 4min
completed: 2026-02-12
---

# Phase 1 Plan 1: Approval Infrastructure Summary

**ActionProposal types, action_proposals DB table with idempotent state machine, and true SSE streaming via async generator replacing collect-then-flush pattern**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-12T22:47:09Z
- **Completed:** 2026-02-12T22:51:23Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Typed ActionProposal lifecycle (proposed/approved/declined/executing/succeeded/failed) in shared package with new ChatStreamEvent variants
- Persistent action_proposals table with CRUD methods following existing StateDb patterns
- ActionStateMachine enforcing valid state transitions with idempotency guard on markExecuting (double-click safe)
- True SSE streaming: chat service yields events incrementally as OpenAI streams chunks, replacing the collect-then-flush antipattern

## Task Commits

Each task was committed atomically:

1. **Task 1: Add action proposal types and DB schema** - `51c7721` (feat)
2. **Task 2: Create ActionStateMachine with idempotency guards** - `5c4ec86` (feat)
3. **Task 3: Refactor chat to true SSE streaming** - `d1768d9` (feat)

## Files Created/Modified
- `packages/shared/src/index.ts` - Added ActionState, ActionPreviewField, ActionProposal types; extended ChatStreamEvent and ChatMessage
- `apps/server/src/db.ts` - Added action_proposals table schema and CRUD methods (create, updateState, getById, getByMessage, getByConversation, getByIdempotencyKey)
- `apps/server/src/services/actionStateMachine.ts` - State machine with transition validation, idempotency guards, and logging
- `apps/server/src/services/chatService.ts` - Added handleMessageStream() async generator with streaming tool call accumulation
- `apps/server/src/routes/chat.ts` - Switched POST /api/chat to use for-await-of over handleMessageStream()

## Decisions Made
- Idempotency key format: `${conversationId}:${toolName}:${JSON.stringify(toolArguments)}:${Date.now()}` -- timestamp included so the same logical action can be re-proposed in different messages while preventing duplicate execution of the same proposal
- markExecuting is idempotent: returns existing proposal without error if already executing or succeeded (handles UI double-click)
- Kept deprecated handleMessage() method intact for backward compatibility -- non-streaming callers can still use it
- Used Map<index, accumulator> pattern for streaming tool call fragment assembly, matching OpenAI's chunk format where tool call pieces arrive with index identifiers

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ActionProposal types and DB infrastructure ready for plan 01-02 (approval UI cards) and 01-03 (execution flow)
- ChatStreamEvent now supports action_proposed and action_update events for real-time approval card rendering
- State machine ready to be wired into tool execution pipeline in subsequent plans

## Self-Check: PASSED

All 5 created/modified files verified on disk. All 3 task commits verified in git history.

---
*Phase: 01-approval-infrastructure-flow*
*Completed: 2026-02-12*
