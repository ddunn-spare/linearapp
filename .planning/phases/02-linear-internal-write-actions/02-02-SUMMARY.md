---
phase: 02-linear-internal-write-actions
plan: 02
subsystem: api
tags: [linear, graphql, mutations, tools, projects, cycles, labels, bulk-operations]

# Dependency graph
requires:
  - phase: 02-linear-internal-write-actions/01
    provides: "Core write tool pattern (create/update/delete issue, comment), name-to-ID resolution helpers, LinearGraphqlClient mutations"
provides:
  - "manage_project tool for creating, updating, and archiving Linear projects"
  - "manage_cycle tool for adding/removing issues from cycles"
  - "manage_labels tool for creating labels and adding/removing from issues"
  - "bulk_update_issues tool with table preview, soft-cap warning, and partial failure handling"
  - "LinearGraphqlClient: createProject, updateProject, addIssueToCycle, removeIssueFromCycle, createLabel, listCyclesForTeam, getIssueLabels"
affects: [02-03, 02-04, 03-github-write-actions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bulk operation pattern: resolve shared values once, iterate issues sequentially, track successes/failures separately"
    - "Partial success result: partialSuccess flag with updatedCount/failedCount for mixed results"
    - "Soft-cap warning: preview includes Warning field when bulk operation exceeds 10 issues"

key-files:
  created: []
  modified:
    - "apps/server/src/adapters/linearGraphql.ts"
    - "apps/server/src/tools/index.ts"
    - "apps/server/src/services/approvalManager.ts"

key-decisions:
  - "Bulk operations use sequential execution (not parallel) for predictable partial failure handling"
  - "Partial success uses markSucceeded (not markFailed) since the action did execute, with descriptive result string"
  - "Soft cap at 10 issues: logs warning and adds preview Warning field but does not block the operation"
  - "Cycle resolution: falls back to db.getActiveCycle() when no cycleName provided"

patterns-established:
  - "Bulk tool pattern: validate > resolve shared values once > iterate > track success/failure > return partialSuccess flag"
  - "Preview with warning: add Warning field to ActionPreviewField[] for user-visible caution messages"

# Metrics
duration: 5min
completed: 2026-02-13
---

# Phase 02 Plan 02: Workflow and Bulk Write Tools Summary

**Project/cycle/label management tools and bulk_update_issues with table preview, soft-cap warning, and partial failure tracking**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-13T01:07:09Z
- **Completed:** 2026-02-13T01:12:29Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added 7 methods to LinearGraphqlClient: createProject, updateProject, addIssueToCycle, removeIssueFromCycle, createLabel, listCyclesForTeam, getIssueLabels
- Registered 4 write tools (manage_project, manage_cycle, manage_labels, bulk_update_issues) with strict schemas, metadata, preview generators, and handlers
- Bulk operations show issue count and change summary in preview, plus Warning field when count exceeds 10
- Partial failure handling: distinguish full success, partial success, and total failure in both handler result and approval manager summary
- ApprovalManager.execute() handles partialSuccess flag: marks action as succeeded with descriptive mixed-results summary

## Task Commits

Each task was committed atomically:

1. **Task 1: Add workflow GraphQL mutations and register project/cycle/label tools** - `1d21469` (feat)
2. **Task 2: Register bulk_update_issues tool with table preview and partial failure handling** - `332e6fb` (feat)

## Files Created/Modified
- `apps/server/src/adapters/linearGraphql.ts` - Added createProject, updateProject, addIssueToCycle, removeIssueFromCycle, createLabel, listCyclesForTeam, getIssueLabels
- `apps/server/src/tools/index.ts` - Four new tool definitions, metadata with preview generators, and handlers with name resolution and bulk iteration
- `apps/server/src/services/approvalManager.ts` - Description and result summary cases for all four tools, plus partial success handling in execute()

## Decisions Made
- Bulk operations execute sequentially (not Promise.all) to ensure predictable partial failure tracking and avoid overwhelming the Linear API
- Partial success uses markSucceeded since the action did run, with a result string like "Updated 3/5 issues (2 failed)" that clearly indicates mixed results
- Soft cap at 10 issues: warning appears in preview and logs but does not prevent execution, per user decision
- Cycle name resolution uses listCyclesForTeam when name provided, falls back to db.getActiveCycle() when null

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript strict null check on array index access**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** `resolved[0].id` in manage_labels handler triggers TS2532 "Object is possibly undefined" even after length check
- **Fix:** Extracted `const foundLabel = resolved[0]` with explicit null check before accessing `.id`
- **Files modified:** apps/server/src/tools/index.ts
- **Verification:** TypeScript compiles cleanly
- **Committed in:** 1d21469 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor TypeScript strictness fix. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All Linear write tools are now registered: core issue tools (02-01) + workflow/bulk tools (02-02)
- Approval card enhancement in Plan 03 can parse bulk_update_issues toolArguments for per-issue table rendering
- Pattern established for bulk operations that Plan 04 or future plans can follow

---
*Phase: 02-linear-internal-write-actions*
*Completed: 2026-02-13*
