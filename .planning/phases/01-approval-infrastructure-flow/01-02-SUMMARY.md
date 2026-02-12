---
phase: 01-approval-infrastructure-flow
plan: 02
subsystem: infra
tags: [approval-manager, tool-registry, strict-mode, write-tool-interception, action-endpoints, system-prompt]

# Dependency graph
requires:
  - phase: 01-01
    provides: ActionProposal types, action_proposals DB, ActionStateMachine, SSE streaming
provides:
  - Tool registry with read/write classification and strict mode schemas
  - ApprovalManager service orchestrating proposal-to-execution lifecycle
  - Write tool interception in chat service (proposals instead of execution)
  - approve/decline/retry/list-proposals REST endpoints
  - Dynamic system prompt with write tool descriptions (DISC-03)
  - Demo write tool (demo_create_issue) for end-to-end testing
affects: [01-03, 02-linear-actions, 03-github-actions]

# Tech tracking
tech-stack:
  added: []
  patterns: [write-tool-interception, synthetic-tool-result-for-llm, approval-manager-orchestration]

key-files:
  created:
    - apps/server/src/services/approvalManager.ts
  modified:
    - apps/server/src/tools/index.ts
    - apps/server/src/services/chatService.ts
    - apps/server/src/routes/chat.ts
    - apps/server/src/app.ts

key-decisions:
  - "System prompt auto-generated from tool registry so write actions are always current (DISC-03)"
  - "Write tool interception feeds synthetic 'proposed_for_approval' result to OpenAI so agent acknowledges naturally"
  - "Approve endpoint chains approve + execute atomically for single-click user experience"
  - "ApprovalManager uses setApprovalManager() setter rather than constructor injection to avoid circular dependency"

patterns-established:
  - "Write tool interception: isWriteTool check before execution, create proposal, feed synthetic result to LLM"
  - "Synthetic tool result pattern: JSON with status/proposalId/message tells LLM action is pending approval"
  - "Approval endpoint pattern: approve then execute in one HTTP call, return final state"

# Metrics
duration: 4min
completed: 2026-02-12
---

# Phase 1 Plan 2: Tool Registry & ApprovalManager Summary

**Tool registry with read/write classification, ApprovalManager orchestrating proposal lifecycle, approve/decline/retry endpoints, and auto-generated system prompt with write action descriptions**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-12T22:53:52Z
- **Completed:** 2026-02-12T22:58:42Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Tool registry extended with ToolMetadata (requiresApproval, category, descriptionForUser, generatePreview) and strict:true + additionalProperties:false on all 13 tool definitions (INFRA-02)
- ApprovalManager service orchestrating full proposal lifecycle: createProposal, approve, execute, decline, retry with idempotency via state machine guards
- Write tool interception in chat service: write tools produce proposals instead of executing, with synthetic "proposed_for_approval" result fed back to OpenAI for natural acknowledgment
- REST endpoints for approve/decline/retry/list-proposals enabling frontend action control
- Dynamic system prompt auto-generated from tool registry, including write action descriptions and decline behavior instructions (DISC-03, APPR-07)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend tool registry with read/write classification and strict mode** - `66e027d` (feat)
2. **Task 2: Create ApprovalManager and integrate with chat service** - `734b2e2` (feat)
3. **Task 3: Add approve/decline/retry endpoints and proposals query** - `10f20c6` (feat)

## Files Created/Modified
- `apps/server/src/tools/index.ts` - Extended with ToolMetadata registry, strict mode on all tools, demo write tool, preview generation, exported classification helpers
- `apps/server/src/services/approvalManager.ts` - New service: proposal creation with preview, approve/execute/decline/retry, description and result summary builders
- `apps/server/src/services/chatService.ts` - Write tool interception in streaming loop, dynamic system prompt via buildSystemPrompt(), ApprovalManager integration via setter
- `apps/server/src/routes/chat.ts` - Added POST approve/decline/retry endpoints, GET proposals-by-conversation endpoint
- `apps/server/src/app.ts` - Wired ActionStateMachine, ApprovalManager, and tool handlers; passed approvalManager to routes

## Decisions Made
- System prompt is auto-generated from tool registry via buildSystemPrompt() so write action descriptions stay current as tools are added (DISC-03)
- Write tool interception feeds a synthetic "proposed_for_approval" JSON result to OpenAI so the LLM can acknowledge the proposal naturally without a second API call
- Approve endpoint chains approve() + execute() atomically so the frontend makes one HTTP call for the complete approve-and-execute flow
- Used setter injection (setApprovalManager) on ChatService instead of constructor parameter to avoid needing to restructure the constructor or create circular initialization dependencies
- Demo write tool (demo_create_issue) added for end-to-end testing -- will be replaced by real Linear tools in Phase 2

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Tool registry and ApprovalManager ready for plan 01-03 (approval UI cards) to render and interact with proposals
- Action endpoints ready for frontend approve/decline/retry button handlers
- Demo write tool enables end-to-end testing of the full approval flow without real Linear API
- System prompt already includes write action descriptions for agent awareness

## Self-Check: PASSED

All 5 created/modified files verified on disk. All 3 task commits verified in git history.

---
*Phase: 01-approval-infrastructure-flow*
*Completed: 2026-02-12*
