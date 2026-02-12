# Project Research Summary

**Project:** AI Action Execution with Approval Flows
**Domain:** Agentic AI chat with human-in-the-loop approval for write actions
**Researched:** 2026-02-12
**Confidence:** HIGH

## Executive Summary

This project adds approval-gated write actions to an existing AI chat system that currently has 12 read-only tools. The research reveals that the core challenge is not technical complexity but architectural discipline: the approval flow requires pausing the OpenAI function calling loop while keeping SSE connections open, presenting clear action previews to users, and ensuring idempotency. The recommended approach is to extend the existing OpenAI SDK-based function calling loop with an ApprovalManager service that uses Promise-based pause/resume, rather than adopting an agent framework like LangChain or Vercel AI SDK which would require replacing working infrastructure.

The key insight from research is that approval-gated actions are a state machine pattern, not a framework feature. The system needs only 4 new frontend dependencies (react-markdown, remark-gfm, rehype-highlight, highlight.js) for rich markdown rendering. All other infrastructure leverages existing components: OpenAI SDK for function calling, better-sqlite3 for approval state persistence, MUI for approval cards, and the existing Linear/GitHub adapters extended with mutation methods. The biggest risk is LLM hallucination of non-existent write actions, which requires strict mode function schemas and explicit capability boundaries in the system prompt.

The research identifies a fundamental UX decision that determines architecture: approval cards must exist outside the message stream as independent entities with their own lifecycle (pending → approved/rejected/expired), not embedded in chat messages. This prevents the conversation from blocking while actions await approval. The roadmap should prioritize building the approval state machine and streaming refactor in Phase 1 before implementing any write tools, as these architectural foundations cannot be retrofitted.

## Key Findings

### Recommended Stack

The existing system provides OpenAI SDK with function calling, 12 read-only tools, Linear GraphQL client, GitHub Octokit client, and SSE streaming. This research covers only additions needed for approval-gated write actions.

**Core technologies:**
- **react-markdown (v10.1.0)** with remark-gfm and rehype-highlight — The standard React markdown renderer for rich AI responses. Uses the unified/remark/rehype pipeline, renders to React components (no dangerouslySetInnerHTML), supports custom component overrides for MUI integration. ESM-only, React 19 compatible.
- **ApprovalManager service (custom)** — Promise-based pause/resume coordinator. Creates pending approvals with in-memory resolver map to bridge SSE handler and approval endpoint. No new dependencies needed beyond existing SQLite for persistence.
- **Extended tool definitions with requiresApproval flag** — Metadata-driven classification of read vs write tools. Each write tool includes a describeAction function that generates human-readable action summaries for approval cards.
- **LinearGraphqlClient mutations** — Extend the existing raw GraphQL client with mutation methods (createIssue, updateIssue, assignIssue, addComment). No need for @linear/sdk which is at v75 with frequent breaking changes.

**Critical decision:** Do NOT use LangChain, Vercel AI SDK, or OpenAI Agents SDK. The existing 50-line function calling loop is simple and correct. Adding approval gating is a ~50-line state machine extension, not a framework migration. Agent frameworks add abstraction layers that obscure the straightforward function calling flow already owned.

### Expected Features

**Must have (table stakes):**
- **Approval card before write actions** — Every agentic product requires confirmation before executing write operations. Card must show: what will change, current vs proposed values, approve/deny buttons.
- **Clear action preview in plain language** — Users must see "Create issue 'Fix login bug' assigned to Devon" not "Execute createIssue with params...". Intent preview is pattern #1 in agentic UX research.
- **Action state indicators** — Visible states for pending-approval, executing (spinner), succeeded, failed. Without this, users panic-click when nothing happens.
- **Success/failure feedback inline** — Users must see the result at the location of the approval card, not in a separate toast. "Done" with checkmark or "Failed" with explanation.
- **Error messages with recovery path** — "I couldn't assign this issue — Devon doesn't have access to Project X. Want me to assign to someone else?" not "Something went wrong."
- **Capability disclosure** — Info button showing what the AI can read vs. create/modify. Users need to discover write actions exist.
- **Contextual action suggestions** — After showing issue details, suggest "Want me to update the priority?" Drives feature discovery.

**Should have (competitive advantage):**
- **Inline edit before approve** — Let users modify proposed action parameters before approving. Reduces deny-and-rephrase cycles.
- **Multi-action plan preview** — When user says "Create a sprint with these 5 issues," show full plan with single "Execute All" button, not 5 separate approvals. This is where competitors are weak.
- **Confidence signals** — When AI is uncertain about a parameter, surface that uncertainty: "I'm guessing this goes in Project Backend — is that right?"
- **Action audit trail** — Persistent log of everything executed, accessible from chat or dedicated view. Shows what, when, result, who approved.

**Defer (v2+):**
- **Undo/rollback** — Store pre-action state and reverse API calls. High value but high cost. Build after action execution is proven.
- **Progressive trust / autonomy dial** — Per-action-type settings for "Always ask" / "Auto-execute" / "Never allow". Requires usage data to know what's safe.
- **Bulk operation preview with dry run** — For "Update all bugs in Sprint 12 to High priority," show scrollable preview of every affected item. Prevents accidental workspace-wide changes.
- **Cross-tool action chaining** — Actions spanning Linear + GitHub in a single flow (e.g., "Create Linear issue for this PR feedback and link them").

**Anti-features (commonly requested but problematic):**
- **Auto-execute all actions without approval** — A single hallucinated action destroys trust permanently. Progressive autonomy dial (v2+) allows opt-in for specific low-risk action types only.
- **Autonomous background agents** — Fundamentally different product (background automation) vs. chat-with-approval model. Requires separate monitoring infrastructure.
- **Natural language to arbitrary API call** — Unbounded action space makes approval UX impossible. Better to do 30 actions well than 300 poorly.

### Architecture Approach

The approval flow introduces a pause-resume cycle into the existing function calling loop. The model proposes an action via tool_call, the server detects it requires approval, the loop pauses, an approval card streams to the client, the server waits for user decision (via Promise), and on approval the tool executes and feeds the result back to the model.

**Major components:**
1. **ChatService (modify)** — Orchestrates function calling loop, detects approval-required tools using ToolRegistry, pauses loop by awaiting ApprovalManager promise, resumes with tool result after approval/decline.
2. **ApprovalManager (new)** — Creates pending approvals in SQLite, maintains Map<approvalId, resolver> for in-memory Promise resolution, handles approve/decline/timeout decisions, coordinates between SSE handler and approval endpoint.
3. **ApprovalCard (new)** — Renders proposed action with structured preview, approve/decline buttons, execution state (pending/executing/done/failed). Sends POST /api/chat/approve on button click.
4. **ToolRegistry (extend)** — Adds requiresApproval boolean and describeAction function to tool definitions. Separates read vs write tools. Auto-generates capability list for system prompt.
5. **Linear/GitHub Adapters (extend)** — Add mutation methods to existing clients. LinearGraphqlClient gains createIssue, updateIssue, assignIssue. GithubClient gains createIssue, createPR, requestReview.

**Key architectural patterns:**
- **Promise-based pause/resume** — When tool requires approval, ChatService creates Promise via ApprovalManager.waitForDecision(id, timeout). The function calling loop awaits this promise, which resolves when user clicks approve/decline or 120s timeout fires. No polling, no WebSocket, no external state machine library.
- **In-memory Promise resolution** — ApprovalManager stores Map<approvalId, { resolve: Function }>. The approval endpoint (POST /api/chat/approve) calls resolve() directly, waking the awaiting function calling loop. Acceptable for single-user local app; would use Redis pub/sub at scale.
- **SSE connection stays open during approval wait** — Fundamental change: the SSE stream does not end after streaming the initial response. It remains open while awaiting approval, then continues streaming the execution result. Requires keep-alive pings (every 15s) and event IDs for reconnection.
- **Approval cards as separate entities** — Not embedded in markdown, not part of chat messages. Separate React components rendered when approval_request SSE event is received. The chat interleaves: AssistantMessage (markdown) → ApprovalCard (MUI) → AssistantMessage (post-approval markdown).

**Critical design decisions:**
- **Do NOT close SSE and reopen for resume** — Keep single SSE connection open for entire message lifecycle including approval wait. Closing/reopening breaks conversational flow and requires complex state reconciliation.
- **Do NOT poll database for approval status** — Use in-memory Promise resolution for lower latency and simpler code. The approval endpoint and SSE handler share the same ApprovalManager service instance.
- **Do NOT treat every tool as needing approval** — Only write/mutating tools require approval. Read tools execute immediately. Gating read tools destroys conversational flow.

### Critical Pitfalls

1. **LLM hallucinating write actions that do not exist** — The model invents tool calls for actions not in the tool registry, or promises to perform actions without emitting tool_calls. Current code does not use strict mode. PREVENTION: Enable strict: true on all function definitions, set parallel_tool_calls: false, validate tool names server-side against whitelist, add system prompt instruction "Only call tools that are explicitly defined. Never promise to perform an action without emitting a tool call."

2. **Approval actions going stale before user responds** — LLM proposes "assign EAM-142 to Alice" but between proposal and approval, Alice becomes overloaded or EAM-142 is reassigned. Local SQLite cache is minutes behind Linear. PREVENTION: At execution time, re-fetch entity from upstream API to verify current state (read-before-write pattern). Store snapshot version (updatedAt) with pending action, compare at execution time. Add 5-minute TTL with "stale" indicator on approval card, auto-expire after 30 minutes.

3. **No idempotency on action execution causing duplicates** — User approves, server executes mutation, Linear succeeds, but SSE response interrupted (network blip, tab refresh). Client never receives confirmation, shows "pending," user retries, duplicate created. PREVENTION: Assign unique actionId (UUID) to every pending action, check completed_actions table before execution. For creates, use idempotency key (hash of parameters). For updates, design as absolute state transitions ("set status to X") not relative ("toggle"). Persist execution result to SQLite BEFORE sending SSE event.

4. **SSE stream interruption during multi-step tool calling loop** — Current code collects all events in array and flushes at end. User sees nothing until entire loop completes (10-30+ seconds). If connection drops mid-stream, ALL events lost including write actions that already executed on server. PREVENTION: Refactor to true streaming — yield events as they occur, write to SSE immediately. Assign sequential event IDs for browser's Last-Event-ID reconnection. Implement keep-alive pings (every 15s). Emit tool_call_executing BEFORE mutation, tool_call_result after, so client knows action was in flight.

5. **Agent trapped in infinite tool-calling loop** — LLM calls same tool repeatedly or burns through 5 iterations without producing final response. With write actions, could propose 5 actions in rapid succession. Current 5-iteration limit is insufficient. PREVENTION: Add per-tool-name limit (same tool max 2x per turn with similar args). Add cost/latency budget (break at 30s elapsed). When write tool is proposed, ALWAYS break out of loop to present approval card — never chain write actions without user intervention. Include explicit guidance in tool error results: "Do NOT retry automatically."

6. **Approval flow blocking the entire conversation** — LLM proposes write action, approval card appears, now entire conversation is blocked until user responds. User cannot ask follow-up questions or modify proposed action. If user sends new message while action pending, the pending action is orphaned. PREVENTION: Model approval actions as separate entity from chat messages. Create PendingAction type with own lifecycle (proposed → approved/rejected/expired), store in dedicated pending_actions table. Approval card has approve/reject/edit buttons that trigger REST API calls, not new chat messages. Allow user to continue chatting while actions pending.

7. **System prompt capability list diverging from actual tool registry** — Current system prompt lists capabilities in natural language, separate from tool definitions. When write actions added, prompt must be updated. If prompt says agent can do something it cannot (or vice versa), LLM hallucinates or refuses valid requests. PREVENTION: Auto-generate capability section from tool definitions. Each tool has description field. Build function that groups tools by category (read/write, Linear/GitHub) and generates capability summary. Include explicit "you CANNOT" statements. Add list_capabilities meta-tool. Write unit test that compares prompt against registry and fails on divergence.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation & Infrastructure (No Write Actions Yet)
**Rationale:** The approval mechanism and streaming architecture must be solid before ANY write tools are added. These are load-bearing architectural changes that cannot be retrofitted. LLM hallucination prevention, idempotency infrastructure, and SSE streaming refactor are prerequisites for safe write action execution.

**Delivers:**
- ApprovalManager service with pending_approvals table
- Tool definitions extended with requiresApproval flag and describeAction function
- SSE streaming refactored from collect-and-flush to true streaming with event IDs and keep-alive
- OpenAI function calling with strict: true and parallel_tool_calls: false
- System prompt auto-generated from tool registry with capability boundaries
- Action state machine (pending/approved/rejected/expired) with idempotency checks
- completed_actions table with actionId deduplication logic
- POST /api/chat/approve endpoint

**Addresses (from FEATURES.md):**
- Action state indicators (foundation)
- Capability disclosure (auto-generated system prompt)

**Avoids (from PITFALLS.md):**
- Pitfall 1: LLM hallucinating write actions (strict mode, capability boundaries)
- Pitfall 3: No idempotency (action state table, deduplication)
- Pitfall 4: SSE stream interruption (streaming refactor, event IDs)
- Pitfall 5: Infinite tool-calling loop (break on write tool proposal)
- Pitfall 7: System prompt diverging from tools (auto-generation)

**Research flag:** Standard patterns. SSE streaming and Promise-based coordination are well-documented. Skip research-phase.

---

### Phase 2: Approval Flow UX
**Rationale:** Build the user-facing approval experience before implementing write tools, so the approval UX can be tested with mock write actions. This validates the state machine, card rendering, and user interaction patterns without risk of actual data mutations.

**Delivers:**
- ApprovalCard component (MUI Card with structured action preview, approve/deny buttons)
- ChatPage handling for approval_request and approval_resolved SSE events
- Plain-language action preview from describeAction functions
- Inline success/failure feedback after approval
- Error messages with recovery paths
- Pending approval card state management (pending → executing → done/failed)
- Staleness detection with 5-minute TTL indicator and 30-minute auto-expire

**Uses (from STACK.md):**
- MUI Card, CardContent, CardActions, Button, Chip, Alert
- MUI icons for action types (AssignmentInd, Edit, Add)

**Implements (from ARCHITECTURE.md):**
- ApprovalCard component with approve/decline handlers
- Frontend state for pending actions (separate from chat messages)
- POST /api/chat/approve REST call on button click

**Addresses (from FEATURES.md):**
- Approval card before write actions (core interaction)
- Clear action preview (intent preview pattern)
- Action state indicators (pending/executing/done/failed)
- Success/failure feedback inline

**Avoids (from PITFALLS.md):**
- Pitfall 2: Approval actions going stale (TTL and staleness detection)
- Pitfall 6: Approval blocking conversation (approval cards separate from messages)

**Research flag:** Standard patterns. Approval card UX follows established agentic UI patterns from Smashing Magazine and Vercel AI SDK research. Skip research-phase.

---

### Phase 3: First Write Tools (Linear Issues)
**Rationale:** Prove the approval flow end-to-end with a single well-scoped write tool before scaling to many. Linear issue creation is the simplest write action: no complex state transitions, well-documented GraphQL mutation, clear success criteria.

**Delivers:**
- LinearGraphqlClient.createIssue mutation
- create_issue tool with requiresApproval: true and describeAction
- Read-before-write validation (re-fetch project/assignee state at execution time)
- End-to-end test: user request → LLM proposes createIssue → approval card → user approves → Linear mutation → success feedback in chat

**Uses (from STACK.md):**
- Existing LinearGraphqlClient with raw GraphQL query() method
- Zod for tool argument validation

**Addresses (from FEATURES.md):**
- Single-action confirmation (the core use case)
- Contextual action suggestions (after showing issue details, suggest "Want me to create a related issue?")

**Avoids (from PITFALLS.md):**
- Pitfall 2: Stale action execution (read-before-write pattern implemented here)
- Pitfall 3: Idempotency (tested with simulated network interruption)

**Research flag:** Standard patterns. Linear GraphQL mutations are documented in Linear API docs. CreateIssue mutation is simple (no complex state). Skip research-phase.

---

### Phase 4: Linear Write Tool Expansion
**Rationale:** With the approval flow proven, expand to other Linear write actions. Group by complexity: status changes and assignments are simpler than project creation or label management.

**Delivers:**
- update_issue_status, assign_issue, add_comment tools
- update_issue (description, priority, labels) tool
- Batch validation: if updating 5 issues, show preview of all 5 before execution
- Error handling for Linear rate limits (RATELIMITED error code detection)

**Addresses (from FEATURES.md):**
- Contextual action suggestions (after workload analysis, suggest "Want me to reassign some issues?")
- Error messages with recovery paths (rate limit guidance)

**Avoids (from PITFALLS.md):**
- Pitfall 5: Infinite loop (per-tool retry limit enforced)

**Research flag:** Standard patterns. All mutations follow same pattern as Phase 3. Skip research-phase.

---

### Phase 5: GitHub Write Tools
**Rationale:** Extend to GitHub after Linear is solid. GitHub REST API has different patterns (no GraphQL, no native idempotency keys) requiring separate implementation strategies.

**Delivers:**
- GithubClient.createIssue, createPR, requestReview, addComment mutations
- Idempotency via search-before-create (check for recent matching issues/comments)
- Cross-reference support (create Linear issue for GitHub PR feedback)

**Uses (from STACK.md):**
- Existing @octokit/rest client

**Addresses (from FEATURES.md):**
- Cross-tool action chaining (Linear + GitHub in single flow)

**Avoids (from PITFALLS.md):**
- GitHub API idempotency (search-before-create pattern)
- GitHub rate limit sharing (track X-RateLimit-Remaining globally)

**Research flag:** NEEDS RESEARCH. GitHub's lack of native idempotency keys and different error patterns may require phase-specific research. Flag for /gsd:research-phase.

---

### Phase 6: Rich Markdown Rendering
**Rationale:** Markdown rendering is independent of write actions and can be added in parallel or after. It enhances read-only responses as well as write action feedback. Place later in roadmap to prioritize core approval functionality.

**Delivers:**
- react-markdown with remark-gfm and rehype-highlight integration
- MUI component mapping (Typography, Link, Table, etc.)
- Code syntax highlighting with github-dark theme
- Tables and task lists in AI responses

**Uses (from STACK.md):**
- react-markdown v10.1.0, remark-gfm v4.0.1, rehype-highlight v7.0.2, highlight.js v11.11.0

**Addresses (from FEATURES.md):**
- Better presentation of action success feedback (structured markdown instead of plain text)

**Research flag:** Standard patterns. react-markdown is well-documented with clear MUI integration examples. Skip research-phase.

---

### Phase 7: Polish & Advanced Features (v2)
**Rationale:** After core approval flow is stable and users are executing actions regularly, add quality-of-life improvements based on usage data.

**Delivers:**
- Inline edit before approve (add when deny rate > 20%)
- Multi-action plan preview (add when users request batch operations)
- Confidence signals (add when automation bias detected)
- Action audit trail (add when users ask "what did the AI do?")
- Undo/rollback for reversible actions (requires pre-action state storage)
- Progressive trust / autonomy dial (requires usage data to know what's safe)

**Addresses (from FEATURES.md):**
- Inline edit before approve (differentiator)
- Multi-action plan preview (competitive advantage)
- Undo/rollback (competitive advantage)
- Progressive trust (differentiator)
- Action audit trail (should-have)

**Research flag:** NEEDS RESEARCH for undo/rollback specifically. Reversing Linear mutations requires understanding Linear's version history and state snapshots. Flag for /gsd:research-phase when reached.

---

### Phase Ordering Rationale

- **Phase 1 before 2:** The approval state machine and SSE streaming refactor are load-bearing architecture. Cannot build approval UX on top of a collect-and-flush streaming pattern.
- **Phase 2 before 3:** Approval UX must exist before write tools can be safely added. Building approval cards with mock write actions validates the interaction pattern without data mutation risk.
- **Phase 3 before 4:** Prove the pattern with a single tool (Linear createIssue) before scaling to many. If the approval flow has issues, they surface in Phase 3 without affecting multiple tools.
- **Phase 4 before 5:** Linear and GitHub have different API patterns (GraphQL vs REST, native vs search-based idempotency). Don't parallelize these — learn from Linear experience before GitHub.
- **Phase 6 independent:** Markdown rendering can happen anytime. Placed later to prioritize functional approval flow over aesthetic improvements.
- **Phase 5 needs research:** GitHub's lack of native idempotency and different error patterns may require additional research. Linear experience from Phases 3-4 may inform GitHub approach, but flag for research to avoid assumptions.
- **Phase 7 needs research for undo:** Reversing actions requires understanding Linear's versioning model and what's actually reversible. This is domain-specific and likely needs dedicated research when reached.

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 5 (GitHub Write Tools):** GitHub REST API has different idempotency patterns than Linear GraphQL. No native idempotency keys, must implement search-before-create. Error patterns differ (rate limit structure, validation errors). Research GitHub-specific implementation strategies before phase planning.
- **Phase 7 (Undo/Rollback):** Reversing Linear mutations requires understanding what's reversible (status changes yes, issue deletion maybe-not), how to store pre-action state, and whether Linear's API supports reversal patterns. Research Linear's version history model and state snapshot capabilities when this phase is planned.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Foundation):** SSE streaming with event IDs, Promise-based coordination, and action state machines are well-documented patterns. OpenAI function calling with strict mode is officially documented.
- **Phase 2 (Approval UX):** Approval card patterns follow established agentic UI research from Smashing Magazine, Vercel AI SDK, and Cloudflare agents. MUI component integration is standard React.
- **Phase 3 (First Write Tools):** Linear createIssue mutation is documented in Linear API docs. Simple mutation, no complex state transitions.
- **Phase 4 (Linear Expansion):** Follows same pattern as Phase 3. All Linear mutations use same GraphQL client and approval flow.
- **Phase 6 (Markdown Rendering):** react-markdown is extensively documented. MUI component mapping examples exist in react-markdown docs and MUI docs.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Core recommendation (extend existing OpenAI loop, no frameworks) is based on current codebase analysis and verified against Vercel AI SDK/LangChain/OpenAI Agents SDK docs which would require full migration. Markdown libraries (react-markdown, remark-gfm) confirmed on npm with React 19 compatibility. |
| Features | MEDIUM-HIGH | Table stakes (approval cards, action preview, state indicators) are validated across multiple sources (Smashing Magazine agentic UX patterns, Vercel AI SDK HITL cookbook, Cloudflare agents docs, Permit.io framework research). Differentiators (multi-action plans, undo, progressive trust) are based on competitive analysis but not yet validated in this specific context. |
| Architecture | HIGH | Promise-based pause/resume pattern is directly validated against OpenAI Agents SDK and LangGraph interrupt patterns (adapted for this simpler use case). In-memory resolver map is standard Node.js concurrency pattern. Codebase analysis shows current SSE implementation and function calling loop, confirming feasibility of refactor. |
| Pitfalls | HIGH | Critical pitfalls (hallucination, staleness, idempotency, SSE interruption) are verified against OpenAI community discussions of tool-calling issues, Linear API rate limiting docs, MDN SSE documentation, and direct analysis of current chatService.ts implementation showing collect-and-flush vulnerability. |

**Overall confidence:** HIGH

The research is grounded in current codebase analysis (verified chatService.ts, tools/index.ts, linearGraphql.ts, chat.ts patterns) combined with official documentation from OpenAI, Linear, and established frontend libraries. The recommendation to extend existing infrastructure rather than adopt frameworks is based on verified code analysis showing a working 50-line function calling loop that would be replaced (not enhanced) by agent frameworks.

Lower confidence areas are future features (Phase 7) which are informed by research but haven't been validated in production, and GitHub-specific implementation patterns which differ enough from Linear to warrant phase-specific research.

### Gaps to Address

- **GitHub idempotency implementation details**: Research identified that GitHub lacks native idempotency keys and requires search-before-create, but specific implementation (how to hash parameters, how recent is "recent", which endpoints support conditional requests) needs deeper investigation in Phase 5 planning.

- **Linear action reversibility model**: Research identified undo/rollback as a competitive advantage but didn't determine which Linear mutations are actually reversible, how Linear's API supports state snapshots, or whether version history can be leveraged. This needs investigation before Phase 7.

- **Token usage optimization strategy**: Pitfalls research identified that full conversation history sent to OpenAI on every iteration causes token explosion, but didn't specify optimal summarization strategy (sliding window size, which tool results to truncate, how to maintain conversational coherence). Monitor in Phase 1 and research if costs spike.

- **Optimal approval card TTL values**: Research recommends 5-minute staleness indicator and 30-minute expiry but these are estimates, not validated thresholds. Adjust based on actual Linear sync frequency and user approval latency observed in Phase 2 testing.

- **Rate limit budget allocation**: Pitfalls research identified Linear API rate limits are shared between sync and chat, recommending request budgeting, but didn't specify allocation percentages or priority-queue implementation. Monitor in Phase 4 when write actions increase request volume, research if rate limits hit.

## Sources

### Primary (HIGH confidence)
- Current codebase: chatService.ts, tools/index.ts, chat.ts, linearGraphql.ts, githubClient.ts, ChatPage.tsx — Direct code review confirms existing function calling loop, SSE implementation, tool registry patterns, and adapter architecture
- [OpenAI Function Calling Docs](https://platform.openai.com/docs/guides/function-calling) — strict mode, parallel_tool_calls, tool_choice behavior
- [react-markdown npm](https://www.npmjs.com/package/react-markdown) — v10.1.0 confirmed, React 19 compatibility via v9+ changelog
- [remark-gfm npm](https://www.npmjs.com/package/remark-gfm) — v4.0.1 confirmed, tables and task list support
- [Linear GraphQL API](https://linear.app/developers/graphql) — issueCreate, issueUpdate, issueAssign mutations documented
- [Linear API Rate Limiting](https://linear.app/developers/rate-limiting) — 5,000 req/hr, 250K complexity points/hr, RATELIMITED error code
- [MDN: Using Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) — Last-Event-ID reconnection, retry directive

### Secondary (MEDIUM confidence)
- [Smashing Magazine: Designing for Agentic AI - Practical UX Patterns (2026)](https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/) — Intent Preview, Autonomy Dial, Action Audit, Confidence Signals patterns
- [Vercel AI SDK: Human-in-the-Loop Cookbook](https://ai-sdk.dev/cookbook/next/human-in-the-loop) — needsApproval pattern, approval state management
- [Cloudflare Agents: Human-in-the-Loop Guide](https://developers.cloudflare.com/agents/guides/human-in-the-loop/) — Workflow approval patterns, durable pausing, timeout handling
- [OpenAI Agents SDK HITL](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/) — needsApproval pattern (evaluated but not recommended for this architecture)
- [Permit.io: Human-in-the-Loop Best Practices](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo) — Risk classification tiers, policy-driven approval
- [Awesome Agentic Patterns: Human-in-Loop Approval Framework](https://github.com/nibzard/awesome-agentic-patterns/blob/main/patterns/human-in-loop-approval-framework.md) — Risk classification, what requires approval vs. bypasses
- [Google Cloud: Agentic AI Design Patterns](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system) — Human-in-the-loop checkpoint pattern
- [OpenAI Community: Hallucinated Tool Calls](https://community.openai.com/t/responses-hallucinated-tool-call/1251417) — o3 hallucination patterns
- [OpenAI Community: Tool-Happy Function Call Over-Use](https://community.openai.com/t/fixing-tool-happy-function-call-over-use-on-ai-on-latest-models-technique-and-investigation/625310) — Excessive tool calling patterns

### Tertiary (LOW confidence)
- [UX Magazine: Secrets of Agentic UX](https://uxmag.com/articles/secrets-of-agentic-ux-emerging-design-patterns-for-human-interaction-with-ai-agents) — Progressive hypothesis formation (general principles, not specific implementation)
- ["Beyond Chat: 8 Core User Intents" by Taras Bakusevych (2026)](https://taras-bakusevych.medium.com/beyond-chat-8-core-user-intents-driving-ai-interaction-4f573685938a) — Delegate and Oversee intents (single source, framework only)
- Notion 3.0, GitHub Copilot, Jira Rovo competitor analysis — Feature comparisons based on marketing materials, not verified through hands-on testing

---
*Research completed: 2026-02-12*
*Ready for roadmap: yes*
