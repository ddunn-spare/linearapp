---
phase: 02-linear-internal-write-actions
plan: 01
subsystem: api
tags: [linear, graphql, mutations, tools, approval-flow]

# Dependency graph
requires:
  - phase: 01-approval-infrastructure-flow
    provides: "Approval state machine, ApprovalManager, tool interception, approval card UI"
provides:
  - "Linear GraphQL mutation methods (createIssue, updateIssue, deleteIssue, addIssueComment)"
  - "Four core write tool definitions with strict mode schemas"
  - "Name-to-ID resolution for assignees, labels, projects, statuses"
  - "ActionCategory type for tool categorization (linear/okr/internal)"
  - "Destructive tool flag for UI warning styling"
affects: [02-02, 02-03, 02-04, 03-github-write-actions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Name-to-ID resolution pattern: tools accept human-readable names, handlers resolve to Linear UUIDs"
    - "Tool handler receives LinearGraphqlClient and AppConfig for API access"
    - "actionCategory field on ToolMetadata for categorizing tools by subsystem"

key-files:
  created: []
  modified:
    - "apps/server/src/adapters/linearGraphql.ts"
    - "apps/server/src/tools/index.ts"
    - "apps/server/src/services/approvalManager.ts"
    - "apps/server/src/services/chatService.ts"
    - "apps/server/src/app.ts"
    - "packages/shared/src/index.ts"

key-decisions:
  - "Tool handlers resolve human-readable names (assigneeName, labelNames, projectName) to IDs at execution time"
  - "ChatService constructor now receives LinearGraphqlClient and AppConfig for write tool handler initialization"
  - "resolveIssueId uses identifier pattern detection (contains dash) to determine if search is needed"

patterns-established:
  - "Write tool pattern: definition (strict schema) + metadata (preview, category, destructive) + handler (resolve names, call API) + approval integration (description, result summary)"
  - "Name resolution helpers: resolveMemberByName, resolveProjectByName, resolveStatusByName as closures in createToolHandlers"

# Metrics
duration: 4min
completed: 2026-02-13
---

# Phase 02 Plan 01: Core Issue Write Tools Summary

**Four Linear issue write tools (create, update, delete, comment) with GraphQL mutations, name-to-ID resolution, and approval flow integration**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-13T01:00:50Z
- **Completed:** 2026-02-13T01:04:51Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Added 6 mutation/query methods to LinearGraphqlClient (createIssue, updateIssue, deleteIssue, addIssueComment, getTeamId with caching, listProjects)
- Registered 4 core write tools (create_issue, update_issue, delete_issue, add_comment) with strict OpenAI schemas, preview generators, and real Linear API handlers
- Replaced demo_create_issue placeholder with production-ready tools that resolve human-readable names to Linear IDs
- Wired approval descriptions and result summaries for all four tools through ApprovalManager

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Linear GraphQL mutation methods and shared types** - `5b5c5c7` (feat)
2. **Task 2: Register core issue write tools and wire into approval manager** - `188f73c` (feat)

## Files Created/Modified
- `apps/server/src/adapters/linearGraphql.ts` - Added createIssue, updateIssue, deleteIssue, addIssueComment mutations plus getTeamId and listProjects queries
- `apps/server/src/tools/index.ts` - Four write tool definitions, metadata with previews, handlers with name-to-ID resolution, destructive flag, actionCategory
- `apps/server/src/services/approvalManager.ts` - Human-readable description and result summary cases for create_issue, update_issue, delete_issue, add_comment
- `apps/server/src/services/chatService.ts` - Updated constructor to accept LinearGraphqlClient and AppConfig for write tool handler initialization
- `apps/server/src/app.ts` - Updated wiring to pass linear client and config to both createToolHandlers and ChatService
- `packages/shared/src/index.ts` - Added ActionCategory type and optional category field on ActionProposal

## Decisions Made
- Tool handlers resolve human-readable names (assigneeName, labelNames, projectName, status) to Linear UUIDs at execution time, keeping the AI-facing interface simple
- ChatService constructor now receives LinearGraphqlClient and AppConfig -- deviation from plan but necessary since ChatService independently creates tool handlers for query execution
- getTeamId uses a Map cache since team IDs do not change during a session

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated ChatService constructor signature**
- **Found during:** Task 2 (TypeScript compilation)
- **Issue:** ChatService independently calls createToolHandlers in its constructor. The new signature requires LinearGraphqlClient and AppConfig, but ChatService did not have access to these.
- **Fix:** Added linear and cfg parameters to ChatService constructor, updated app.ts to pass them
- **Files modified:** apps/server/src/services/chatService.ts, apps/server/src/app.ts
- **Verification:** TypeScript compiles cleanly
- **Committed in:** 188f73c (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary fix for TypeScript compilation. ChatService needed the same dependencies as the standalone createToolHandlers call. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Four core write tools are ready for end-to-end testing via the existing approval flow
- Pattern established for all future write tools (OKR, cycle, label management) in plans 02-03 and 02-04
- ActionCategory type ready for UI to differentiate tool styling

## Self-Check: PASSED

All 6 modified files verified present on disk. Both task commits (5b5c5c7, 188f73c) verified in git log. TypeScript compiles without errors.

---
*Phase: 02-linear-internal-write-actions*
*Completed: 2026-02-13*
