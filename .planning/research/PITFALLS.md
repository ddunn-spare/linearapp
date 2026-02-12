# Pitfalls Research

**Domain:** AI chat with human-in-the-loop action execution and approval flows
**Researched:** 2026-02-12
**Confidence:** HIGH (domain-specific, verified against current codebase and multiple sources)

## Critical Pitfalls

### Pitfall 1: LLM Hallucinating Write Actions That Do Not Exist

**What goes wrong:**
The LLM invents tool calls for write actions that are not defined in the tool registry. With the current codebase using 12 read-only tools and no `strict: true` on function schemas, OpenAI models can and do hallucinate function names. When write tools like `update_issue_status` or `assign_issue` are added alongside the existing read-only tools, the LLM may also fabricate plausible-sounding actions like `delete_issue`, `create_sprint`, or `merge_pull_request` that do not exist. Worse, the LLM may promise to perform an action in its text response ("I've updated the status for you") without actually emitting a tool call, leaving the user believing something happened that did not.

**Why it happens:**
The current tool definitions do not use OpenAI's strict mode (`strict: true`), which means schema adherence is best-effort rather than guaranteed. The existing `chatService.ts` casts tool call arguments loosely (`(tc as any).function`). Models like o3 are documented as more prone to hallucinating tool calls, especially promising to call tools "in the background" or in future turns. When the system prompt lists capabilities in natural language (as the current `SYSTEM_PROMPT` does), the model may conflate described capabilities with available tools.

**How to avoid:**
1. Enable `strict: true` on all function definitions. Per OpenAI docs, this is now the default in the Responses API but NOT in Chat Completions (which this codebase uses). Requires `additionalProperties: false` on all parameter objects.
2. Set `parallel_tool_calls: false` to prevent the model from emitting multiple tool calls simultaneously, ensuring exactly zero or one tool per turn. This is critical for approval flows where each action needs individual confirmation.
3. Add a system prompt instruction: "Only call tools that are explicitly defined. Never promise to perform an action without emitting a tool call. If a tool does not exist for the requested action, say so."
4. Validate tool names server-side against a whitelist before execution (the current code already returns `"Unknown tool"` for missing handlers, which is good, but this should also block the tool result from being sent back to the model as if it succeeded).
5. Separate read-only and write tool definitions clearly in the system prompt so the model understands the boundary.

**Warning signs:**
- Assistant responses contain phrases like "I've done X" or "I'll handle that" without a corresponding `tool_call_start` SSE event
- `tool_call_result` events returning `"Unknown tool"` errors in production logs
- Tool names in logs that are close-but-not-exact matches to defined tools

**Phase to address:**
Phase 1 (Write Tool Infrastructure) -- strict mode and validation must be in place before any write tools are registered.

---

### Pitfall 2: Approval Actions Going Stale Before User Responds

**What goes wrong:**
The LLM proposes an action (e.g., "assign EAM-142 to Alice") and an approval card is shown to the user. Between the time the action is proposed and the time the user clicks "Approve," the underlying data changes: maybe Alice is now overloaded, or EAM-142 was already assigned by someone directly in Linear. The action executes against stale state, creating conflicts or undesired outcomes. This is especially dangerous because the local SQLite database is a cache of Linear's truth, synced periodically -- it can be minutes behind reality.

**Why it happens:**
The current architecture syncs from Linear/GitHub on a schedule (via `linearSyncService` and `githubSyncService`). Between syncs, the local SQLite snapshot diverges from Linear's actual state. When the LLM queries local data to build an action proposal, the data may already be stale. If the user waits minutes or hours before approving, staleness compounds further. There is no mechanism today to re-validate data freshness at approval time.

**How to avoid:**
1. At approval execution time, re-fetch the relevant entity from the upstream API (Linear GraphQL, GitHub) to verify current state before executing the mutation. This is a "read-before-write" pattern.
2. Store the "snapshot version" (e.g., `updatedAt` timestamp from Linear) alongside each pending action. At execution time, compare the snapshot version against the current version. If they differ, show the user what changed and ask for re-confirmation.
3. Add a TTL (time-to-live) on pending approval cards. After 5 minutes without action, visually mark the card as "stale" with an option to refresh. After 30 minutes, auto-expire it and require the user to re-ask.
4. For the `query_data` tool that runs raw SQL against the local database: never base a write action on raw SQL results without re-validation against the upstream API.

**Warning signs:**
- Users report "I approved it but the result was different from what the card showed"
- Linear webhook events showing rapid back-and-forth status changes (indicating conflict between the app's mutation and a human's direct action in Linear)
- Action execution failures with "issue not found" or "state already X" errors

**Phase to address:**
Phase 2 (Approval Flow) -- TTL and staleness detection are core to the approval card UX. Phase 3 (Action Execution) -- read-before-write validation at execution time.

---

### Pitfall 3: No Idempotency on Action Execution Causing Duplicates

**What goes wrong:**
User approves an action. The HTTP request to execute it succeeds on the server, the Linear mutation completes, but the SSE response back to the client is interrupted (browser tab refresh, network blip, laptop lid close). The client never receives confirmation, so it shows the action as "pending." User clicks approve again, or the system retries automatically, creating a duplicate issue, double-assigning, or double-moving an issue. This is especially dangerous for create-type mutations (e.g., creating a new issue or comment) which are not naturally idempotent.

**Why it happens:**
The current SSE implementation in `chat.ts` writes events to `reply.raw` and ends. There is no message ID or delivery confirmation. If the connection drops between the server executing the action and the client receiving the `tool_call_result` event, the client has no way to know the action succeeded. Neither the Linear API nor the GitHub API provide built-in idempotency keys on their mutation endpoints. The current `chatService.ts` does not track execution state of individual tool calls.

**How to avoid:**
1. Assign a unique `actionId` (UUID) to every pending action at proposal time. Store it in the database with a status (`pending`, `approved`, `executing`, `completed`, `failed`). Before execution, check if an action with this ID has already been completed.
2. For create-type mutations: use a client-generated idempotency key (hash of action parameters + conversation context) stored in a `pending_actions` table. Before executing, query whether an action with matching parameters has completed within the last N minutes.
3. For update-type mutations (e.g., change status, assign issue): these are naturally idempotent if the mutation is "set status to X" rather than "toggle status." Design all update actions as absolute state transitions, not relative ones.
4. After execution, persist the result immediately to SQLite in a `completed_actions` table BEFORE sending the SSE event. This ensures that even if the SSE delivery fails, a page reload can show the completed state.
5. On the client: when reconnecting or reloading, fetch the current status of any recent pending actions to reconcile the display.

**Warning signs:**
- Duplicate issues appearing in Linear after network-interrupted approval flows
- Action status stuck in "executing" state after server restart
- Users reporting "I approved it twice because it didn't seem to work the first time"

**Phase to address:**
Phase 1 (Write Tool Infrastructure) -- action state table and idempotency infrastructure. Phase 3 (Action Execution) -- execution engine with idempotency checks.

---

### Pitfall 4: SSE Stream Interruption During Multi-Step Tool Calling Loop

**What goes wrong:**
The current `chatService.ts` executes a synchronous loop of up to 5 iterations of LLM calls and tool executions, collecting all events in an array, then writing them all to the SSE stream at the end. This means: (a) the user sees nothing until the entire loop completes, which can take 10-30+ seconds with multiple tool calls, and (b) if the connection drops mid-stream, ALL events are lost including any tool calls that already executed. The server has no way to resume. When write actions are added, this means an action could execute on the server (Linear mutation succeeds) but the user never sees the result.

**Why it happens:**
Looking at the current code in `chatService.ts`, the `handleMessage` method collects events in a `const events: ChatStreamEvent[] = []` array and returns them. The route handler in `chat.ts` then iterates over events and writes them one by one. This is a "collect then flush" pattern rather than a true streaming pattern. The events array can be large (5 iterations x multiple tool calls each). The SSE connection has no keep-alive, no event IDs, and no reconnection support.

**How to avoid:**
1. Refactor to a true streaming architecture: yield events as they occur rather than collecting them all. Use a callback or async generator pattern so the route handler writes each event to the SSE stream immediately.
2. Assign sequential event IDs to SSE messages (`id: N` field). This enables the browser's built-in `Last-Event-ID` reconnection mechanism -- on reconnect, the client sends the last ID it received, and the server can replay missed events from a buffer.
3. Implement SSE keep-alive: send `:\n\n` (comment) or `event: ping` every 15 seconds to prevent proxy/load-balancer timeouts and detect dead connections.
4. For write actions specifically: emit a `tool_call_executing` event BEFORE executing the mutation, and `tool_call_result` after. If the connection drops between these, the client knows an action was in flight and can poll for its status on reconnect.
5. Store the complete event stream for each message in the database (the current code partially does this by saving `toolCalls` on the assistant message). Ensure it is written incrementally so a reconnecting client can recover the full stream.

**Warning signs:**
- Users reporting "the AI was thinking for a long time then everything appeared at once"
- "Thinking..." spinner persisting for more than 10 seconds without any tool call indicators
- Partial responses appearing after page reload (from the database) that were not seen during the live stream
- Network tab showing the SSE connection timing out or being terminated by a proxy

**Phase to address:**
Phase 1 (Write Tool Infrastructure) -- streaming refactor must happen before write tools go live. Without true streaming, write action feedback is dangerously delayed.

---

### Pitfall 5: Agent Trapped in Infinite Tool-Calling Loop

**What goes wrong:**
The LLM enters a loop where it keeps calling tools without ever producing a final text response. With the current 5-iteration hard limit, this burns through 5 API calls to OpenAI (cost and latency) before breaking out. When write actions are added, this could mean the agent proposes 5 write actions in rapid succession in a single turn, overwhelming both the approval UX and potentially executing multiple mutations if auto-approval is ever enabled. The loop can also manifest as the model calling the same read tool repeatedly because it "doesn't trust" the result, or calling tools with slightly different parameters hoping for a different outcome.

**Why it happens:**
The current code has a `maxIterations = 5` guard, which is good but not sufficient. The model can misinterpret termination signals, believe work is not truly done, or get stuck re-processing old information. With write actions, the model may interpret an approval-pending state as "tool call failed" and retry with a different approach. If a tool returns an error (e.g., Linear rate limit), the model may retry the same tool immediately.

**How to avoid:**
1. Keep the existing iteration limit (5 is reasonable) but add a per-tool-name limit: the same tool should not be called more than 2 times within a single message turn with the same or substantially similar arguments.
2. Add a cost/latency budget: if total elapsed time exceeds 30 seconds or total token usage exceeds a threshold, break out of the loop with a graceful message.
3. When a write tool is proposed, ALWAYS break out of the loop to present the approval card. Never let the model chain from one write action to another without user intervention. This means: after emitting an approval-requiring tool call, stop the iteration loop and return to the user.
4. If a tool returns an error, include explicit guidance in the tool result: "This tool call failed. Do NOT retry automatically. Inform the user of the failure and ask how to proceed."
5. Track tool call patterns across a conversation. If the model is calling the same tool with the same arguments across multiple user turns, surface a warning.

**Warning signs:**
- SSE streams with 3+ `tool_call_start` events for the same tool name in a single response
- Response latency consistently hitting the 5-iteration ceiling
- Token usage per message spiking unexpectedly
- Users complaining about slow responses or "the AI seems confused"

**Phase to address:**
Phase 1 (Write Tool Infrastructure) -- loop-breaking on write tool detection. Phase 3 (Action Execution) -- per-tool retry limits and circuit breakers.

---

### Pitfall 6: Approval Flow Blocking the Entire Conversation

**What goes wrong:**
The LLM proposes a write action, an approval card appears, and now the entire conversation is blocked until the user responds. The user cannot ask follow-up questions, request modifications to the proposed action, or continue the conversation while an action is pending. Alternatively, if the user sends a new message while an action is pending, the pending action is orphaned (never approved, never rejected) and accumulates as ghost state. This is a fundamental architectural problem because the current `handleMessage` method is request-response: one user message in, one assistant response out.

**Why it happens:**
The current architecture is synchronous request-response over SSE. There is no concept of a "pending action" that lives outside the message stream. The chat message model (`ChatMessage` type) has `toolCalls` as an array on the assistant message, but there is no status field per tool call. The SSE stream ends with a `done` event, closing the interaction. There is no mechanism for the user to interact with a pending approval card without sending a new chat message.

**How to avoid:**
1. Model approval actions as a separate entity from chat messages. Create a `PendingAction` type with its own lifecycle: `proposed -> approved/rejected/expired`. Store it in a dedicated `pending_actions` table, not embedded in the chat message.
2. The approval card should be a UI component with approve/reject/edit buttons that trigger REST API calls (e.g., `POST /api/actions/:id/approve`), NOT new chat messages. This keeps the approval flow out of the message stream.
3. Allow the user to continue chatting while actions are pending. The next chat message should include context about any pending actions in the system prompt so the LLM knows about them.
4. When the user approves an action, execute it and insert a system-style message into the conversation showing the result, without requiring a new LLM call.
5. When the user rejects an action, mark it as rejected and optionally ask the LLM to suggest an alternative by sending a system message like "The user rejected the proposed action: [description]. Acknowledge this and ask if they'd like a different approach."

**Warning signs:**
- Users copy-pasting "approve" or "yes" as chat messages instead of clicking buttons (means they don't understand the approval UX)
- Conversations with many unanswered approval cards piling up
- Users starting new conversations to "get past" a stuck approval card
- Feature usage dropping after initial adoption (suggests review fatigue or blocking frustration)

**Phase to address:**
Phase 2 (Approval Flow) -- this is THE core design decision for the approval architecture. Getting this wrong forces a rewrite.

---

### Pitfall 7: The System Prompt Capability List Diverging from Actual Tool Registry

**What goes wrong:**
The current system prompt in `chatService.ts` lists capabilities in natural language ("Search and analyze issues from Linear", "Check team workload", etc.). When write actions are added, this list must be updated. If the system prompt says the agent can do something it cannot (or vice versa), the LLM will either hallucinate actions or refuse valid requests. This becomes a maintenance nightmare as tools are added incrementally across phases.

**Why it happens:**
The system prompt is a hardcoded string, separate from the tool definitions. There is no mechanism to auto-generate the capability description from the tool registry. When a developer adds a new tool to the `getToolDefinitions()` function, they must also remember to update the system prompt. The current codebase has 12 tools but the system prompt only describes 7 high-level capabilities -- there is already a gap.

**How to avoid:**
1. Auto-generate the capability section of the system prompt from the tool definitions. Each tool already has a `description` field. Build a function that groups tools by category (read vs. write, Linear vs. GitHub vs. internal) and generates a capabilities summary.
2. Include explicit "you CANNOT" statements: "You cannot delete issues. You cannot push code. You cannot modify OKRs directly." This prevents the model from attempting actions that seem reasonable but are not implemented.
3. For write tools, include the approval requirement in the tool description: "This action requires user approval before execution."
4. Add a meta-tool like `list_capabilities` that returns the current tool registry. The model can call this if it is unsure whether it can perform a requested action.
5. Test for divergence: write a unit test that compares the system prompt's described capabilities against the actual tool registry and fails if they diverge.

**Warning signs:**
- Users asking "Can you do X?" and the LLM confidently saying yes, then failing at tool call time
- LLM refusing to do things it actually can (because the system prompt does not mention the capability)
- Different behavior between "fresh" conversations (which use the current system prompt) and older conversations (which may have different prompt context in message history)

**Phase to address:**
Phase 1 (Write Tool Infrastructure) -- auto-generated capability list should be built before write tools are added.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Embedding action state in chat messages instead of a separate table | Simpler schema, fewer queries | Cannot track action lifecycle independently, no way to query "all pending actions," orphaned actions invisible | Never -- separate action state from day one |
| Auto-approving "safe" write actions without user confirmation | Faster UX for simple actions like status changes | Users lose trust when unintended changes happen; no clear line between "safe" and "unsafe" evolves over time | Only after Phase 3 is stable AND user has explicitly opted in per action type |
| Using the LLM to interpret approval responses ("The user said 'sure' which means approve") | Natural conversation flow | Misinterpretation leads to unintended action execution; "sure" could be sarcasm; ambiguous responses are common | Never -- use explicit UI buttons |
| Skipping read-before-write validation to reduce API calls | Lower latency, fewer API calls | Silent data conflicts, stale mutations, user confusion when result differs from preview | MVP only, with a clear TODO to add validation in Phase 3 |
| Not implementing SSE event IDs and reconnection | Simpler SSE implementation | Lost events on network interruption, no recovery path for write action confirmations | Current read-only system only; must fix before write actions |
| Storing pending actions only in client-side React state | No new database tables or API endpoints needed | Page refresh loses all pending actions, no recovery, no audit trail | Never for write actions |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Linear GraphQL API | Treating HTTP 400 as a generic error when it may contain `RATELIMITED` error code in the response body | Parse the GraphQL error extensions for the `RATELIMITED` code specifically. Read `X-RateLimit-Requests-Remaining` header on every response. Implement backoff when remaining < 100. The current `linearGraphql.ts` throws a generic error on `payload.errors` without checking the error code. |
| Linear GraphQL API | Polling Linear for updates after executing a mutation to verify it took effect | Use Linear webhooks instead of polling. The mutation response itself contains `{ success: boolean }`. Trust the response; do not re-fetch to confirm. |
| Linear GraphQL API | Not accounting for the complexity point system when building mutations alongside existing read queries | Mutations count toward the 250,000 complexity points/hour budget shared with read queries. A burst of write actions could exhaust the budget and break the periodic sync. Monitor `X-RateLimit-Complexity-Remaining`. |
| GitHub API (Octokit) | No built-in idempotency keys on GitHub's REST API for create operations | Before creating a GitHub issue or PR comment, search for recently created items matching the same parameters (title + body hash). Use conditional requests (`If-None-Match`) for reads. For PR reviews, check existing review state before submitting. |
| GitHub API (Octokit) | Assuming GitHub API rate limits are per-endpoint when they are per-authenticated-user | All GitHub REST API calls share a single rate limit pool (5,000/hour for authenticated). Write actions plus existing read sync can exhaust this quickly. Track `X-RateLimit-Remaining` globally. |
| SQLite (better-sqlite3) | Executing a write action and updating the local SQLite cache simultaneously without a transaction | Wrap "execute external mutation + update local cache" in a pattern where the external mutation succeeds first, then the local cache is updated. Do NOT update the local cache optimistically before the external mutation confirms. If the external mutation fails, the local cache should not change. |
| OpenAI Chat Completions | Sending the full conversation history (including all tool call results) on every LLM turn, causing token count to explode | The current code sends ALL history on every iteration. With 5 iterations per message and large tool results (e.g., `query_data` returning 50 rows), tokens accumulate fast. Summarize or truncate tool results in message history after initial processing. Cap tool result content to a reasonable length (e.g., 2000 characters). |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full conversation history sent to OpenAI on every tool-calling iteration | Slow responses, high token costs, eventually hitting context window limits | Implement a sliding window or summarization strategy for message history. Truncate old tool call results. Only send last N messages plus a system summary. | Conversations longer than ~20 messages with tool calls (realistic within a single session) |
| Synchronous tool execution in the iteration loop | Each tool call blocks the next; 3 tool calls at 500ms each = 1.5s minimum per iteration, 5 iterations = 7.5s+ | For read-only tools, execute in parallel when the LLM requests multiple. For write tools, execute sequentially but stream intermediate results. | First time a user makes a complex request requiring 3+ tool calls |
| Linear API rate limit shared between sync jobs and chat actions | Chat write actions fail with RATELIMITED during a sync cycle | Implement a request budgeting system: reserve a portion of the hourly budget for interactive chat actions, separate from background sync. Priority-queue chat requests over sync. | Active chat usage during a full sync cycle (5,000 req/hr limit can be hit with ~83 req/min from sync alone) |
| Storing complete tool call arguments and results in chat_messages.tool_calls_json | Database bloat, slow conversation loading | Cap stored tool results at 1000 characters. Store a summary rather than full JSON dumps. Index on conversation_id. | After ~100 conversations with heavy tool usage |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| The existing `query_data` tool allows arbitrary SELECT queries against the entire SQLite database | With write actions stored in the same database, the LLM could query `pending_actions` or `action_history` tables to see action parameters, potentially leaking sensitive data or enabling the LLM to reason about its own execution infrastructure in unintended ways | Restrict `query_data` to a whitelist of table names. Better: remove raw SQL access entirely and replace with specific read tools. |
| Write tool parameters passed through from LLM output without sanitization | SQL injection if tool parameters are interpolated into queries; GraphQL injection if parameters are embedded in mutation strings | Use parameterized queries exclusively (the current code does this for reads). For Linear GraphQL mutations, always use variables, never string interpolation. The existing `linearGraphql.ts` correctly uses variables. |
| No audit log of approved/rejected/executed actions | No accountability, no ability to diagnose or reverse unintended changes | Log every action with: who proposed it (agent), what was proposed, whether it was approved/rejected, the execution result, and a timestamp. Store in a dedicated `action_audit_log` table. |
| Action parameters visible in SSE stream transmitted over the network | In the current CORS-open configuration (`Access-Control-Allow-Origin: *`), any page can read the SSE stream | Since this is single-user trusted environment, this is acceptable for MVP. But the CORS wildcard in `chat.ts` should be narrowed to the actual frontend origin before any write actions go live. |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Approval card that only shows "Approve" and "Reject" without showing what will change | User cannot make an informed decision; approves blindly or rejects out of uncertainty | Show a structured diff: "This will change: Status: In Progress -> Done, Assignee: Alice -> Bob". Include the entity identifier and title. |
| Requiring approval for every single write action including trivial ones | Review fatigue -- user starts approving everything without reading, which defeats the purpose | Categorize actions by risk level. Low-risk (e.g., adding a label) could be auto-approvable with an undo option. High-risk (e.g., creating issues, changing assignments) always require approval. Let the user configure their threshold over time. |
| Showing approval cards inline in the streaming response, making them scroll away | User misses the approval card as the conversation continues; or user scrolls up, approves a stale action | Pin the most recent pending approval card, or show a persistent notification/badge. Keep the card visible even if the user continues chatting. Consider a dedicated "Pending Actions" panel. |
| Not showing what happened after an action executes | User approves, then nothing visible changes in the chat. Did it work? Did it fail? | Insert a clear result message: "Done -- EAM-142 status changed to In Progress. [View in Linear]". Include a link to the affected entity. Show green/red status indicator. |
| The AI proposing batch actions ("I'll update all 5 issues") as a single approval | User must approve or reject all 5 changes as a unit, even if they only disagree with one | Break batch actions into individual approval cards. Or show a batch card with per-item checkboxes. Never force all-or-nothing on multi-entity mutations. |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Approval cards:** Often missing the "what will change" preview -- verify the card shows a structured before/after diff, not just the action name
- [ ] **Action execution:** Often missing error handling for partial success (e.g., Linear mutation succeeds but local cache update fails) -- verify both succeed or the local cache is marked dirty for next sync
- [ ] **SSE streaming:** Often missing keep-alive pings -- verify the stream sends a ping every 15 seconds and the client reconnects on drop
- [ ] **Idempotency:** Often missing the "check before execute" step -- verify every write action checks `completed_actions` table before hitting the external API
- [ ] **Tool definitions:** Often missing `strict: true` -- verify ALL tool definitions include `strict: true` and `additionalProperties: false` on all parameter objects
- [ ] **Action audit log:** Often missing rejection logging -- verify rejected actions are logged, not just approved ones
- [ ] **Stale action detection:** Often missing TTL enforcement -- verify pending actions older than 30 minutes are auto-expired, not silently sitting in the database
- [ ] **System prompt:** Often missing negative capability statements -- verify the prompt explicitly states what the agent CANNOT do, not just what it can do
- [ ] **Rate limiting awareness:** Often missing budget tracking -- verify the app tracks remaining Linear API quota and degrades gracefully before hitting limits
- [ ] **Client-side recovery:** Often missing reconnection state -- verify that after a page reload, the chat loads pending actions from the server, not just from React state

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Duplicate action executed (idempotency failure) | MEDIUM | Detect via audit log. For status changes: the second mutation is a no-op since status is already set. For issue creation: manually delete the duplicate in Linear. Add the duplicate's ID to a blocklist. |
| Stale action executed (data changed between proposal and approval) | LOW-MEDIUM | The action itself is valid but may be undesired. Show the user a "This action executed against data that changed since it was proposed. Here is what changed. Would you like to revert?" message. For status changes, revert is simple. For issue creation, flag for manual review. |
| LLM hallucinated an action and user approved it | LOW | The action will fail at the handler level (unknown tool). Show a clear error to the user: "This action is not available." The real cost is user confusion. Add the hallucinated tool name to the system prompt as an explicit "do not use" instruction. |
| SSE connection dropped mid-write-execution | MEDIUM | Server-side: the action is already persisted in `pending_actions` with a status. On client reconnect, fetch action status from the server. If completed, show the result. If in-flight, show a "checking status" indicator. |
| Conversation history token limit exceeded | LOW | Implement automatic history truncation: summarize messages older than N turns. Archive old tool call results. The truncated history will not include the detailed context, but the system prompt provides baseline capabilities. |
| Linear API rate limited during chat action | LOW | Return a user-friendly error: "Linear's API is temporarily busy. Your action has been queued and will execute shortly." Implement a simple retry queue with exponential backoff (max 3 retries over 60 seconds). |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| LLM hallucinating write actions | Phase 1: Write Tool Infrastructure | Unit test: send a prompt requesting a non-existent action and verify no tool call is emitted. Verify `strict: true` on all tool definitions. |
| Approval actions going stale | Phase 2: Approval Flow UX | Integration test: propose an action, modify the underlying data in Linear, approve the action, verify staleness is detected before execution. |
| No idempotency on execution | Phase 1: Write Tool Infrastructure | Test: execute an action, simulate SSE drop, re-submit the same action, verify it is not executed twice. Verify `completed_actions` table is checked. |
| SSE stream interruption | Phase 1: Write Tool Infrastructure | Test: start a multi-tool response, kill the connection mid-stream, reconnect, verify all events are recoverable. Verify event IDs are present. |
| Infinite tool-calling loop | Phase 1: Write Tool Infrastructure | Test: craft a prompt that would trigger repeated tool calls. Verify the loop breaks after 5 iterations AND that no single tool is called more than 2 times with similar arguments. |
| Approval blocking conversation | Phase 2: Approval Flow UX | UX test: propose an action, then without approving, send another message. Verify the conversation continues and the pending action remains accessible. |
| System prompt diverging from tools | Phase 1: Write Tool Infrastructure | Automated test: compare tool registry against system prompt. Fail if a tool exists without a corresponding capability description. |
| Review fatigue from excessive approvals | Phase 4: Polish and Refinement | Metrics: track approval rate over time. If acceptance rate exceeds 95% consistently, offer the user auto-approval for those action types. |
| Token limit exceeded in tool calling loop | Phase 1: Write Tool Infrastructure | Test: conversation with 30+ messages and heavy tool usage. Verify response times remain under 15 seconds and no context window errors. |
| Rate limit exhaustion during chat + sync | Phase 3: Action Execution | Monitor: track `X-RateLimit-Requests-Remaining` across sync and chat. Alert when remaining drops below 500. Implement request budgeting. |

## Sources

- [OpenAI Function Calling Docs](https://platform.openai.com/docs/guides/function-calling) -- strict mode, parallel_tool_calls, tool_choice (HIGH confidence)
- [Linear API Rate Limiting](https://linear.app/developers/rate-limiting) -- 5,000 req/hr, 250K complexity points/hr, RATELIMITED error code (HIGH confidence, verified via WebFetch)
- [Smashing Magazine: Designing For Agentic AI -- Practical UX Patterns](https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/) -- review fatigue, approval card design, autonomy calibration (MEDIUM confidence)
- [Permit.io: Human-in-the-Loop for AI Agents](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo) -- approval gate patterns, hallucinated actions, overreach (MEDIUM confidence)
- [LLM Tool-Calling in Production: Rate Limits, Retries, and Infinite Loops](https://medium.com/@komalbaparmar007/llm-tool-calling-in-production-rate-limits-retries-and-the-infinite-loop-failure-mode-you-must-2a1e2a1e84c8) -- infinite loop failure mode, idempotency keys, retry storms (MEDIUM confidence)
- [OpenAI Community: Hallucinated Tool Calls](https://community.openai.com/t/responses-hallucinated-tool-call/1251417) -- o3 hallucination patterns (MEDIUM confidence)
- [OpenAI Community: Tool-Happy Function Call Over-Use](https://community.openai.com/t/fixing-tool-happy-function-call-over-use-on-ai-on-latest-models-technique-and-investigation/625310) -- model calling tools excessively (MEDIUM confidence)
- [Portkey: Retries, Fallbacks, and Circuit Breakers in LLM Apps](https://portkey.ai/blog/retries-fallbacks-and-circuit-breakers-in-llm-apps/) -- circuit breaker patterns for LLM tool calling (MEDIUM confidence)
- [SnapLogic: Agent Continuations for Resumable AI Workflows](https://www.snaplogic.com/blog/agent-continuations-for-resumable-ai-workflows) -- pause/resume patterns for approval flows (MEDIUM confidence)
- [MDN: Using Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) -- Last-Event-ID reconnection, retry directive (HIGH confidence)
- [Composio: Why AI Agent Pilots Fail in Production](https://composio.dev/blog/why-ai-agent-pilots-fail-2026-integration-roadmap) -- agent execution failures, missing action plane (MEDIUM confidence)
- Current codebase analysis: `chatService.ts`, `tools/index.ts`, `chat.ts`, `linearGraphql.ts`, `db.ts` (HIGH confidence -- direct code review)

---
*Pitfalls research for: AI chat with human-in-the-loop action execution and approval flows*
*Researched: 2026-02-12*
