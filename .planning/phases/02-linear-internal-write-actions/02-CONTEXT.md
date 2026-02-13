# Phase 2: Linear & Internal Write Actions - Context

**Gathered:** 2026-02-12
**Status:** Ready for planning

<domain>
## Phase Boundary

All Linear mutations (create, update, delete issues; manage projects, cycles, labels; bulk operations) and internal OKR management (create, update, delete OKRs and key results; link issues), all flowing through the approval infrastructure built in Phase 1. Discovery UI and GitHub actions are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Bulk Operations
- Single approval card for all changes in a bulk operation (approve/decline the whole batch)
- Detailed table preview: each issue on its own row showing title, current state, and new state
- Soft cap with warning above a threshold (e.g., 10+ issues) but still allow the operation
- Partial failure handling: mark action as partially succeeded, show which items succeeded and which failed with reasons

### Approval Card Detail
- Show action type, issue identifier, and specific fields being set/changed
- For creates: show essential fields (title, priority, assignee) upfront, other fields in a collapsed/expandable section
- Always show Linear issue identifier + title together (e.g., "ENG-123: Fix login bug")
- Destructive actions (delete) get red/warning styling on the approval card to signal irreversibility

### Update Behavior
- Multi-field updates in a single action: one approval card showing all field changes together
- Agent infers reasonable defaults for fields the user didn't mention, shows them in the approval card so user sees everything before approving
- Comments show full text in the approval card — user sees every word before it posts
- Descriptions support markdown formatting

### OKR Operations
- Full CRUD: create, update, delete OKRs and key results; link/unlink issues to key results
- Agent proactively suggests issue-to-KR links when it sees a match (shown as approval card)
- Auto-calculate key result progress from linked issue data and propose the update for approval
- Color-coded approval cards: subtle color/icon difference to distinguish Linear vs OKR actions

### Claude's Discretion
- Exact soft cap threshold for bulk operations
- Which fields count as "essential" vs expandable per action type
- Loading and error state presentation details
- Exact color/icon scheme for Linear vs OKR differentiation

</decisions>

<specifics>
## Specific Ideas

- Approval cards should show identifier + title for quick recognition (mirrors Linear's own UI pattern)
- Bulk operation table should feel like a spreadsheet preview — clear, scannable
- Warning styling on destructive actions should be visually distinct but not alarming for routine operations

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-linear-internal-write-actions*
*Context gathered: 2026-02-12*
