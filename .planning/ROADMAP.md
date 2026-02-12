# Roadmap: AI Chat Actions & Approvals

## Overview

This roadmap delivers approval-gated write actions for the existing AI chat assistant. The journey starts with the approval infrastructure and UX (the load-bearing architecture), then proves the pattern with Linear and internal write tools, extends to GitHub, and finishes with discovery UI and rich markdown rendering. Every phase builds on the last, with the first phase delivering the most architectural risk reduction.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Approval Infrastructure & Flow** - Action proposal, approval cards, execution lifecycle, and streaming foundation
- [ ] **Phase 2: Linear & Internal Write Actions** - All Linear mutations and OKR management through the approval flow
- [ ] **Phase 3: GitHub Write Actions** - Pull request, issue, and comment actions via GitHub REST API
- [ ] **Phase 4: Discovery & Rendering** - Capability info button, contextual suggestions, and rich markdown in chat

## Phase Details

### Phase 1: Approval Infrastructure & Flow
**Goal**: Users can see, approve, and decline agent-proposed actions with clear feedback at every lifecycle stage
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, APPR-01, APPR-02, APPR-03, APPR-04, APPR-05, APPR-06, APPR-07, DISC-03
**Success Criteria** (what must be TRUE):
  1. When the agent proposes a write action, an approval card appears inline in chat showing a plain-language description of what will change
  2. User can approve or decline a proposed action with one click, and the agent responds appropriately to either decision
  3. After approval, the action executes and the result (success or failure with explanation) appears inline in chat
  4. Action state is visible throughout its lifecycle (pending, executing, succeeded, failed) and persists across page refresh
  5. Double-clicking approve does not execute the action twice
**Plans**: TBD

Plans:
- [ ] 01-01: SSE streaming refactor and approval state machine
- [ ] 01-02: ApprovalManager service, tool registry extensions, and system prompt auto-generation
- [ ] 01-03: Approval card UI, chat integration, and end-to-end approval flow

### Phase 2: Linear & Internal Write Actions
**Goal**: Agent can create, update, and manage Linear issues, projects, cycles, labels, and internal OKRs through the approval flow
**Depends on**: Phase 1
**Requirements**: LIN-01, LIN-02, LIN-03, LIN-04, LIN-05, LIN-06, LIN-07, LIN-08, INT-01, INT-02
**Success Criteria** (what must be TRUE):
  1. User can ask the agent to create a Linear issue and see it appear in Linear after approval
  2. User can ask the agent to update issue fields (status, priority, assignee, labels, description), delete issues, and add comments
  3. User can ask the agent to manage projects, cycles, and labels in Linear
  4. User can ask the agent to perform bulk operations on multiple issues at once with a preview of all changes before approval
  5. User can ask the agent to create and update OKRs and key results
**Plans**: TBD

Plans:
- [ ] 02-01: Core Linear issue tools (create, update, delete, comment)
- [ ] 02-02: Linear workflow tools (projects, cycles, labels, bulk operations)
- [ ] 02-03: Internal OKR tools (create, update OKRs and key results)

### Phase 3: GitHub Write Actions
**Goal**: Agent can create and manage pull requests, issues, and comments in GitHub through the approval flow
**Depends on**: Phase 1
**Requirements**: GH-01, GH-02, GH-03, GH-04
**Success Criteria** (what must be TRUE):
  1. User can ask the agent to create a pull request and see it appear in GitHub after approval
  2. User can ask the agent to merge a pull request after approval
  3. User can ask the agent to create GitHub issues and add comments to PRs and issues
**Plans**: TBD

Plans:
- [ ] 03-01: GitHub write tools (create PR, merge PR, create issue, add comments)

**Research flag**: GitHub REST API lacks native idempotency keys. Plan-phase should investigate search-before-create patterns for deduplication.

### Phase 4: Discovery & Rendering
**Goal**: Users can discover what the agent can do and see rich formatted responses in chat
**Depends on**: Phase 1 (approval flow for context), Phase 2 (Linear actions exist to discover)
**Requirements**: DISC-01, DISC-02, REND-01, REND-02, REND-03
**Success Criteria** (what must be TRUE):
  1. Info button at top of chat shows a categorized list of everything the agent can read and do
  2. After the agent shows read results, contextual action suggestions appear when a natural follow-up write action exists
  3. Chat messages render markdown with proper formatting including headers, bold, italic, lists, tables, and syntax-highlighted code blocks
**Plans**: TBD

Plans:
- [ ] 04-01: Capability info button and contextual action suggestions
- [ ] 04-02: Rich markdown rendering with react-markdown, tables, and code highlighting

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4
Note: Phases 2 and 3 both depend on Phase 1 but not on each other. They are ordered sequentially because Linear experience informs GitHub implementation.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Approval Infrastructure & Flow | 0/3 | Not started | - |
| 2. Linear & Internal Write Actions | 0/3 | Not started | - |
| 3. GitHub Write Actions | 0/1 | Not started | - |
| 4. Discovery & Rendering | 0/2 | Not started | - |
