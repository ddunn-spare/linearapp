---
phase: 02-linear-internal-write-actions
plan: 03
subsystem: api
tags: [okr, tools, approval-flow, category, system-prompt]

# Dependency graph
requires:
  - phase: 02-linear-internal-write-actions/02-01
    provides: "Core write tool pattern, ActionCategory type, tool metadata infrastructure"
provides:
  - "Five OKR write tools (create_okr, update_okr, delete_okr, update_key_result, link_issue_to_kr)"
  - "Category field on ActionProposal persisted to DB for UI differentiation"
  - "Grouped system prompt (Linear Actions vs OKR Actions) with proactive OKR linking instructions"
  - "getWriteToolSummariesGrouped() for category-based tool listing"
affects: [02-04, ui-approval-card-styling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dynamic preview setup: tools needing db access get generatePreview assigned in createToolHandlers"
    - "Category flow: tool metadata -> approvalManager -> stateMachine -> DB -> toActionProposal"
    - "System prompt groups tools by actionCategory for structured LLM guidance"

key-files:
  created: []
  modified:
    - "apps/server/src/tools/index.ts"
    - "apps/server/src/services/approvalManager.ts"
    - "apps/server/src/services/actionStateMachine.ts"
    - "apps/server/src/services/chatService.ts"
    - "apps/server/src/db.ts"

key-decisions:
  - "OKR tools registered in 02-02 commit alongside workflow tools -- Task 1 was already complete"
  - "Category column added via ALTER TABLE migration (not schema change) for backward compat"
  - "System prompt proactive OKR instruction embedded in write tools section, not as separate section"

patterns-established:
  - "Category propagation: metadata -> approvalManager -> stateMachine -> DB -> API response"
  - "Grouped system prompt pattern: getWriteToolSummariesGrouped returns Map<category, tools[]>"

# Metrics
duration: 8min
completed: 2026-02-13
---

# Phase 02 Plan 03: OKR Write Tools and Category Flow Summary

**Five OKR write tools with category-aware approval proposals and grouped system prompt for proactive OKR linking suggestions**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-13T01:07:19Z
- **Completed:** 2026-02-13T01:15:38Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Verified five OKR write tools (create_okr, update_okr, delete_okr, update_key_result, link_issue_to_kr) are registered with metadata, definitions, handlers, and approval integration
- Added category field propagation through the full approval pipeline: tool metadata -> ApprovalManager -> ActionStateMachine -> DB -> API response
- Grouped system prompt by tool category (Linear Actions, OKR Actions) for clearer LLM guidance
- Added proactive OKR linking instruction to system prompt so agent suggests issue-to-KR links

## Task Commits

Each task was committed atomically:

1. **Task 1: Register OKR write tools** - `1d21469` (feat, committed in 02-02 wave)
2. **Task 2: Add proposal category flow and enhance system prompt** - `87fabdc` (feat)

## Files Created/Modified
- `apps/server/src/tools/index.ts` - Added getWriteToolSummariesGrouped() export for category-based tool listing
- `apps/server/src/services/approvalManager.ts` - Resolves actionCategory from tool metadata and passes to stateMachine
- `apps/server/src/services/actionStateMachine.ts` - Accepts optional category parameter in createProposal, includes it in ActionProposal
- `apps/server/src/services/chatService.ts` - System prompt groups tools by category with proactive OKR linking instruction
- `apps/server/src/db.ts` - Migration adds category column to action_proposals, stores and reads category on proposals

## Decisions Made
- Task 1 OKR tools were already committed as part of 02-02 execution (commit 1d21469) since the tools were added in the same code wave. Verified all five tools exist with correct metadata.
- Category column added via ALTER TABLE migration with DEFAULT 'internal' for backward compatibility with existing proposals.
- Proactive OKR instruction embedded directly in the write tools section of the system prompt rather than as a separate section, keeping it contextually close to the tool descriptions.

## Deviations from Plan

None - plan executed as written. Task 1's OKR tool registration was found already committed from the 02-02 execution wave, so only verification was needed. Task 2 was implemented fresh.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All internal write tools (issue, project, cycle, label, OKR) are registered and flowing through approval
- Category field on proposals enables UI to style approval cards differently per tool type
- Plan 02-04 can now build on the complete write tool surface

## Self-Check: PASSED
