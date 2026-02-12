# Requirements: AI Chat Actions & Approvals

**Defined:** 2026-02-12
**Core Value:** The AI agent can propose and execute real actions across Linear, GitHub, and internal tools — with user approval before anything changes.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Infrastructure

- [ ] **INFRA-01**: Chat service supports true SSE streaming (not collect-then-flush) so users see real-time feedback during action execution
- [ ] **INFRA-02**: OpenAI tool definitions use strict mode to prevent hallucinated action parameters
- [ ] **INFRA-03**: Action state machine tracks lifecycle: proposed → approved/declined → executing → succeeded/failed
- [ ] **INFRA-04**: Pending actions persist in database so conversations can resume after page refresh
- [ ] **INFRA-05**: Idempotency checks prevent duplicate action execution from double-click approvals

### Approval Flow

- [ ] **APPR-01**: Agent presents inline approval card in chat when proposing a write action
- [ ] **APPR-02**: Approval card shows plain-language preview of what will change (not raw JSON)
- [ ] **APPR-03**: User can approve or decline a proposed action with one click
- [ ] **APPR-04**: Approved action executes immediately and shows success result inline in chat
- [ ] **APPR-05**: Failed action shows error with plain-language explanation and recovery suggestion
- [ ] **APPR-06**: Action state indicators visible throughout lifecycle (pending, executing, succeeded, failed)
- [ ] **APPR-07**: Declined action tells the agent to try a different approach or ask for clarification

### Linear Actions

- [ ] **LIN-01**: Agent can create a new issue with title, description, priority, and assignee
- [ ] **LIN-02**: Agent can update issue fields (status, priority, assignee, labels, description)
- [ ] **LIN-03**: Agent can delete an issue
- [ ] **LIN-04**: Agent can add comments to issues
- [ ] **LIN-05**: Agent can create and manage projects
- [ ] **LIN-06**: Agent can manage cycles (add/remove issues from cycles)
- [ ] **LIN-07**: Agent can create and manage labels
- [ ] **LIN-08**: Agent can perform bulk operations (update multiple issues at once)

### GitHub Actions

- [ ] **GH-01**: Agent can create pull requests
- [ ] **GH-02**: Agent can merge pull requests
- [ ] **GH-03**: Agent can add comments to PRs and issues
- [ ] **GH-04**: Agent can create GitHub issues

### Internal Actions

- [ ] **INT-01**: Agent can create OKRs with key results
- [ ] **INT-02**: Agent can update existing OKRs and key results

### Discovery

- [ ] **DISC-01**: Info button at top of chat showing categorized list of agent capabilities
- [ ] **DISC-02**: Contextual action suggestions appear after read results when a natural follow-up action exists
- [ ] **DISC-03**: System prompt accurately reflects available actions so agent knows its own capabilities

### Rendering

- [ ] **REND-01**: Chat renders markdown with proper formatting (headers, bold, italic, lists)
- [ ] **REND-02**: Chat renders markdown tables with readable formatting
- [ ] **REND-03**: Chat renders code blocks with syntax highlighting

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Approval

- **APPR-08**: User can edit proposed action parameters before approving (inline edit)
- **APPR-09**: Multi-action plan preview with "Execute All" for batch workflows
- **APPR-10**: Undo/rollback with time-limited window for reversible actions

### Trust & Oversight

- **TRST-01**: Progressive trust dial — per-action-type auto-execute settings
- **TRST-02**: Action audit trail with chronological log of all executed actions
- **TRST-03**: Confidence signals on proposed actions when agent is uncertain

### Advanced Operations

- **ADV-01**: Cross-tool action chaining (e.g., create Linear issue from GitHub PR feedback and link them)
- **ADV-02**: Bulk operation preview with dry-run simulation

## Out of Scope

| Feature | Reason |
|---------|--------|
| Auto-execute without approval | Single hallucinated action destroys trust; progressive trust deferred to v2 |
| Background autonomous agents | Fundamentally different product from chat-with-approval; separate milestone |
| Natural language to arbitrary API call | Unbounded action space makes approval UX impossible; curated tool set |
| Real-time collaborative approval | Massively increases complexity; single-user sufficient |
| Voice/multimodal approval | Error-prone; keyboard shortcuts sufficient for power users |
| Approval via Slack/email | Splits context; keep approval where conversation lives |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | — | Pending |
| INFRA-02 | — | Pending |
| INFRA-03 | — | Pending |
| INFRA-04 | — | Pending |
| INFRA-05 | — | Pending |
| APPR-01 | — | Pending |
| APPR-02 | — | Pending |
| APPR-03 | — | Pending |
| APPR-04 | — | Pending |
| APPR-05 | — | Pending |
| APPR-06 | — | Pending |
| APPR-07 | — | Pending |
| LIN-01 | — | Pending |
| LIN-02 | — | Pending |
| LIN-03 | — | Pending |
| LIN-04 | — | Pending |
| LIN-05 | — | Pending |
| LIN-06 | — | Pending |
| LIN-07 | — | Pending |
| LIN-08 | — | Pending |
| GH-01 | — | Pending |
| GH-02 | — | Pending |
| GH-03 | — | Pending |
| GH-04 | — | Pending |
| INT-01 | — | Pending |
| INT-02 | — | Pending |
| DISC-01 | — | Pending |
| DISC-02 | — | Pending |
| DISC-03 | — | Pending |
| REND-01 | — | Pending |
| REND-02 | — | Pending |
| REND-03 | — | Pending |

**Coverage:**
- v1 requirements: 32 total
- Mapped to phases: 0
- Unmapped: 32 ⚠️

---
*Requirements defined: 2026-02-12*
*Last updated: 2026-02-12 after initial definition*
