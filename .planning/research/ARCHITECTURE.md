# Architecture Research: Approval-Gated Action Execution

**Domain:** AI chat with human-in-the-loop action approval
**Researched:** 2026-02-12
**Confidence:** HIGH

## System Overview

The approval flow introduces a **pause-resume cycle** into the existing function calling loop. The model proposes an action via a tool call, the server detects it requires approval, the loop pauses, an approval card is streamed to the client, the server waits for a user decision, and on approval the tool executes and feeds the result back to the model.

```
Existing Flow (read-only tools):
  Model ──tool_call──> Server ──execute──> Result ──feed back──> Model

New Flow (write tools requiring approval):
  Model ──tool_call──> Server ──detect write──> PAUSE
       │
       ├── Stream approval_request event to client
       ├── Client renders approval card
       ├── User clicks Approve / Decline
       ├── Client sends POST /api/chat/approve with decision
       │
       ├── IF approved: execute tool, feed result to model, RESUME loop
       └── IF declined: feed "user declined" to model, RESUME loop
```

### Layer Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React/MUI)                     │
│  ┌───────────┐  ┌────────────────┐  ┌───────────────────┐   │
│  │ ChatPage  │  │ ApprovalCard   │  │ StreamingMessage  │   │
│  │ (exists)  │  │ (NEW)          │  │ (exists)          │   │
│  └─────┬─────┘  └───────┬────────┘  └─────────┬─────────┘   │
│        │                │                      │             │
├────────┴────────────────┴──────────────────────┴─────────────┤
│                     API / SSE Transport                       │
│  POST /api/chat (exists)    POST /api/chat/approve (NEW)     │
│  SSE events: delta, tool_call_start, tool_call_result,       │
│              approval_request (NEW), approval_resolved (NEW),│
│              done, error                                     │
├──────────────────────────────────────────────────────────────┤
│                     Server (Fastify)                          │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────┐  │
│  │ ChatService    │  │ ApprovalManager │  │ ToolRegistry │  │
│  │ (modify loop)  │  │ (NEW)           │  │ (extend)     │  │
│  └───────┬────────┘  └────────┬────────┘  └──────┬───────┘  │
│          │                    │                   │          │
├──────────┴────────────────────┴───────────────────┴──────────┤
│                     Tool Handlers                             │
│  ┌───────────┐  ┌────────────┐  ┌────────────┐              │
│  │ Read Tools│  │ Write Tools│  │ Adapters   │              │
│  │ (exist)   │  │ (NEW)      │  │ (extend)   │              │
│  └───────────┘  └────────────┘  └────────────┘              │
├──────────────────────────────────────────────────────────────┤
│                     Data Layer                                │
│  ┌──────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │ SQLite   │  │ pending_approvals│  │ Linear/GitHub API │  │
│  │ (exists) │  │ table (NEW)      │  │ (extend mutations)│  │
│  └──────────┘  └──────────────────┘  └───────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **ChatService** (modify) | Orchestrates function calling loop, detects approval-required tools, pauses/resumes loop | ApprovalManager, ToolRegistry, OpenAI |
| **ApprovalManager** (new) | Creates pending approvals, stores state, resolves approve/decline, notifies waiters | ChatService, Database, SSE transport |
| **ToolRegistry** (extend) | Declares tools with `requiresApproval` flag, separates read vs write definitions | ChatService, Tool Handlers |
| **ApprovalCard** (new) | Renders proposed action with approve/decline buttons in chat stream | ChatPage, API client |
| **Write Tool Handlers** (new) | Execute write operations against Linear/GitHub/internal when called | Adapters (Linear, GitHub), Database |
| **Linear Adapter** (extend) | Add mutation methods: createIssue, updateIssue, addComment, etc. | Linear GraphQL API |
| **GitHub Adapter** (extend) | Add mutation methods: createPR, createIssue, requestReview, etc. | GitHub REST API (Octokit) |
| **chat route** (modify) | Add `/api/chat/approve` endpoint, extend SSE event types | ChatService, ApprovalManager |

## Recommended Project Structure Changes

```
apps/server/src/
├── tools/
│   ├── index.ts              # MODIFY: add requiresApproval flag to tool defs
│   ├── readTools.ts           # NEW: extract existing read-only handlers
│   └── writeTools.ts          # NEW: write tool definitions + handlers
├── services/
│   ├── chatService.ts         # MODIFY: pause/resume loop for approvals
│   └── approvalManager.ts     # NEW: pending approval state management
├── adapters/
│   ├── linearGraphql.ts       # MODIFY: add mutation methods
│   └── githubClient.ts        # MODIFY: add write methods
├── routes/
│   └── chat.ts                # MODIFY: add /api/chat/approve endpoint
packages/shared/src/
│   └── index.ts               # MODIFY: add approval types and SSE events
apps/web/src/
├── pages/
│   └── ChatPage.tsx           # MODIFY: handle approval events, render cards
└── components/
    └── ApprovalCard.tsx        # NEW: approval UI component
```

### Structure Rationale

- **tools/readTools.ts + writeTools.ts**: Separating read and write tools makes it obvious which tools need approval. The existing `index.ts` becomes an aggregator that merges both sets.
- **services/approvalManager.ts**: Dedicated service rather than inlining approval logic in chatService, because approval state management (create, resolve, timeout, persist) is a distinct concern.
- **ApprovalCard.tsx**: Standalone component because approval cards have their own interactive state (buttons, loading, resolved state) unlike passive message bubbles.

## Architectural Patterns

### Pattern 1: Promise-Based Pause/Resume in Function Calling Loop

**What:** When the function calling loop encounters a write tool, it creates a Promise that resolves when the user approves/declines. The loop `await`s this promise, which effectively pauses it without blocking the server.

**When to use:** Every time a tool with `requiresApproval: true` is called by the model.

**Trade-offs:** Simple, no external state machine library needed. The SSE connection stays open during the pause. Timeout required to prevent indefinite hangs.

**Example:**
```typescript
// In chatService.ts function calling loop
for (const tc of msg.tool_calls) {
  const toolDef = toolRegistry.get(tc.function.name);

  if (toolDef.requiresApproval) {
    // Create pending approval and stream card to client
    const approval = approvalManager.create({
      conversationId,
      toolCallId: tc.id,
      toolName: tc.function.name,
      toolArgs: JSON.parse(tc.function.arguments),
      description: toolDef.describeAction(JSON.parse(tc.function.arguments)),
    });

    emitSSE({ type: "approval_request", approval });

    // PAUSE: await user decision (resolves on approve/decline or timeout)
    const decision = await approvalManager.waitForDecision(approval.id, 120_000);

    if (decision.approved) {
      const result = await toolDef.handler(JSON.parse(tc.function.arguments));
      emitSSE({ type: "approval_resolved", approvalId: approval.id, approved: true });
      // Feed result back to model
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    } else {
      emitSSE({ type: "approval_resolved", approvalId: approval.id, approved: false });
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify({ declined: true, reason: decision.reason || "User declined" }),
      });
    }
  } else {
    // Existing path: execute immediately
    const result = await toolDef.handler(JSON.parse(tc.function.arguments));
    messages.push({ role: "tool", tool_call_id: tc.id, content: result });
  }
}
```

### Pattern 2: Approval Manager with In-Memory Resolver Map

**What:** ApprovalManager maintains a `Map<approvalId, { resolve: Function }>` of pending Promises. When `/api/chat/approve` is called, it looks up the resolver and calls it. This avoids database polling.

**When to use:** This is the primary coordination mechanism between the SSE handler and the approval endpoint.

**Trade-offs:** Approvals are lost on server restart (acceptable for single-user local app). For production multi-server environments, you would use a message queue or database polling instead.

**Example:**
```typescript
class ApprovalManager {
  private pending = new Map<string, {
    resolve: (decision: ApprovalDecision) => void;
    approval: PendingApproval;
    timer: NodeJS.Timeout;
  }>();

  create(params: CreateApprovalParams): PendingApproval {
    const approval: PendingApproval = {
      id: crypto.randomUUID(),
      ...params,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    // Persist to DB for recovery/history
    this.db.savePendingApproval(approval);
    return approval;
  }

  waitForDecision(approvalId: string, timeoutMs: number): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(approvalId);
        resolve({ approved: false, reason: "Timeout" });
      }, timeoutMs);

      this.pending.set(approvalId, {
        resolve,
        approval: this.db.getPendingApproval(approvalId)!,
        timer,
      });
    });
  }

  resolve(approvalId: string, approved: boolean, reason?: string): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(approvalId);
    entry.resolve({ approved, reason });
    return true;
  }
}
```

### Pattern 3: Tool Definitions with Metadata Flag

**What:** Extend the existing tool definition pattern to include a `requiresApproval` boolean and a `describeAction` function that generates a human-readable summary of what the tool will do given its arguments.

**When to use:** All write tools get `requiresApproval: true`. All existing read tools keep the default `false`.

**Trade-offs:** Minimal refactoring of existing tool registration. The `describeAction` function adds a small burden per tool but is essential for meaningful approval cards.

**Example:**
```typescript
type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  handler: ToolHandler;
  describeAction?: (args: Record<string, unknown>) => string;
};

// Write tool example
const createIssueTool: ToolDefinition = {
  name: "create_issue",
  description: "Create a new issue in Linear",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Issue title" },
      description: { type: "string", description: "Issue description" },
      assigneeId: { type: "string", description: "Assignee user ID" },
      priority: { type: "number", description: "Priority (0=none, 1=urgent, 4=low)" },
    },
    required: ["title"],
  },
  requiresApproval: true,
  handler: async (args) => { /* Linear mutation */ },
  describeAction: (args) =>
    `Create issue "${args.title}" ${args.assigneeName ? `assigned to ${args.assigneeName}` : "unassigned"}`,
};
```

## Data Flow

### Primary Flow: Agent Proposes Action, User Approves, Action Executes

```
1. User sends message
   ChatPage ──POST /api/chat──> chat route ──> ChatService.handleMessage()

2. OpenAI returns tool_call for write tool
   ChatService: model response includes tool_calls: [{ name: "create_issue", ... }]

3. ChatService detects requiresApproval, creates pending approval
   ChatService ──> ApprovalManager.create() ──> SQLite (persist)

4. Approval card streamed to client
   ChatService ──SSE: approval_request──> ChatPage
   ChatPage renders <ApprovalCard> inline in message stream

5. User clicks "Approve"
   ApprovalCard ──POST /api/chat/approve──> chat route
   chat route ──> ApprovalManager.resolve(id, true)

6. Promise resolves, tool executes
   ApprovalManager.resolve() ──resolves Promise──> ChatService (awaiting)
   ChatService ──> writeToolHandler() ──> Linear/GitHub API
   ChatService ──SSE: approval_resolved──> ChatPage (card updates to "Executed")

7. Result fed back to model, loop continues
   ChatService pushes tool result to messages array
   ChatService calls OpenAI again (next iteration of loop)
   Model generates response incorporating the action result

8. Final response streamed
   ChatService ──SSE: delta──> ChatPage (renders assistant text)
   ChatService ──SSE: done──> ChatPage (stream complete)
```

### Decline Flow

```
Steps 1-4: Same as above

5. User clicks "Decline"
   ApprovalCard ──POST /api/chat/approve { approved: false }──> chat route
   chat route ──> ApprovalManager.resolve(id, false)

6. Promise resolves with declined
   ChatService feeds { declined: true } as tool result to model
   ChatService ──SSE: approval_resolved { approved: false }──> ChatPage

7. Model acknowledges decline
   Model receives the tool result indicating decline
   Model generates response like "Understood, I won't create that issue."
   ChatService ──SSE: delta──> ChatPage
```

### Timeout Flow

```
Steps 1-4: Same as above

5. No user action within 120 seconds
   ApprovalManager timeout fires, resolves Promise with { approved: false, reason: "Timeout" }
   ChatService ──SSE: approval_resolved { approved: false, reason: "Timeout" }──> ChatPage

6. Model acknowledges timeout
   Same as decline flow step 7
```

### SSE Event Types (Extended)

```typescript
// NEW events added to ChatStreamEvent union
type ChatStreamEvent =
  | { type: "delta"; content: string }
  | { type: "tool_call_start"; toolCall: { id: string; name: string } }
  | { type: "tool_call_result"; toolCall: { id: string; name: string; result: string } }
  | { type: "approval_request"; approval: PendingApproval }     // NEW
  | { type: "approval_resolved"; approvalId: string; approved: boolean; result?: string }  // NEW
  | { type: "done"; messageId: string }
  | { type: "error"; error: string };
```

## Critical Design Decisions

### Decision 1: SSE Connection Stays Open During Approval Wait

The existing pattern sends all events then closes the connection. With approvals, the SSE connection must remain open while waiting for the user to approve/decline. This is a fundamental change to the request lifecycle.

**Why this works:** The existing `POST /api/chat` already uses SSE. The response stream stays open until `reply.raw.end()`. We delay calling `end()` until the approval resolves. The browser fetch keeps reading from the stream.

**Constraint:** The approval endpoint (`POST /api/chat/approve`) is a separate HTTP request. It communicates with the waiting SSE handler via the in-memory ApprovalManager.

### Decision 2: In-Memory Promise Resolution, Not Polling

Rather than having the SSE handler poll the database for approval status, use an in-memory `Map<approvalId, resolver>`. The approval endpoint calls the resolver directly, which wakes up the awaiting function calling loop.

**Why:** Lower latency, simpler code, no polling interval to tune. The in-memory approach is appropriate because this is a single-server, single-user application.

### Decision 3: describeAction Generates Human-Readable Summaries

Each write tool defines a `describeAction(args)` function that returns a human-readable string like "Create issue 'Fix login bug' assigned to Devon". This text appears in the approval card.

**Why not just show raw tool name and args:** Users need to understand what they are approving without reading JSON. The model's intent should be clear at a glance.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Linear GraphQL | Add mutations to existing `LinearGraphqlClient` | `createIssue`, `updateIssue`, `deleteIssue`, `addComment`, `createProject`, `assignIssue`, `addLabel` |
| GitHub REST (Octokit) | Add write methods to existing `GithubClient` | `createIssue`, `createPR`, `requestReview`, `addComment` |
| OpenAI | No changes to adapter | Function calling protocol unchanged; pause happens in our loop |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| ChatService <-> ApprovalManager | Direct method calls + Promise | Same process, no serialization needed |
| SSE handler <-> Approval endpoint | ApprovalManager in-memory map | Separate HTTP requests sharing same service instance |
| Frontend <-> Approval endpoint | POST /api/chat/approve | JSON body: `{ approvalId, approved, reason? }` |
| ChatPage <-> ApprovalCard | React props + callback | Card renders inline, calls parent handler on button click |

## Anti-Patterns

### Anti-Pattern 1: Separate WebSocket for Approvals

**What people do:** Add a WebSocket connection alongside SSE for bidirectional approval communication.
**Why it's wrong:** Adds protocol complexity, connection management, and reconnection logic for something that works fine as a simple POST endpoint + existing SSE stream.
**Do this instead:** Keep SSE for server-to-client streaming. Use a standard REST POST for the client-to-server approval decision. The ApprovalManager bridges the two.

### Anti-Pattern 2: Closing SSE and Reopening for Resume

**What people do:** End the SSE stream when an approval is needed, then start a new stream when the user responds.
**Why it's wrong:** Breaks the conversational flow. The frontend loses the streaming context. Requires complex state reconciliation between streams.
**Do this instead:** Keep the single SSE connection open for the entire message lifecycle, including the approval wait period.

### Anti-Pattern 3: Database Polling for Approval Status

**What people do:** Write the approval to a DB table, then have the function calling loop poll the DB every N ms waiting for status change.
**Why it's wrong:** Adds latency (poll interval), wastes CPU, introduces timing issues.
**Do this instead:** Use in-memory Promise resolution via the ApprovalManager. The resolver is called directly when the approval endpoint receives the user's decision.

### Anti-Pattern 4: Treating Every Tool Call as Needing Approval

**What people do:** Add approval gates to all tools, including read-only queries.
**Why it's wrong:** Destroys the conversational flow. "Can I search for issues?" "Can I check workload?" becomes tedious. Users will stop using the chat.
**Do this instead:** Only write/mutating tools require approval. Read tools execute immediately as they do today.

### Anti-Pattern 5: Model Generates the Approval Card HTML

**What people do:** Have the model output structured approval content as part of its response text.
**Why it's wrong:** The model is unreliable at generating exact UI structures. The approval mechanism should be deterministic, not generated.
**Do this instead:** The approval card is rendered from the structured `PendingApproval` data. The model just calls the tool; the system determines how to present it.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single user (current) | In-memory ApprovalManager, no auth, SQLite persistence for history |
| 1-10 users | Add user context to approvals, session-scoped approval maps |
| 100+ users | Replace in-memory map with Redis pub/sub for cross-process coordination, add proper auth, consider approval persistence for crash recovery |

### Scaling Priorities

1. **First bottleneck:** SSE connection duration. If approval waits are long (minutes), the server holds open connections. Fastify handles this fine for single-user. At scale, add connection timeouts and reconnection logic.
2. **Second bottleneck:** In-memory approval map size. If many conversations have pending approvals, memory grows. Unlikely for this use case but would need Redis at scale.

## Build Order (Dependencies)

The approval system has clear dependencies that dictate build order:

```
Phase 1: Foundation (no UI yet, no approval yet)
  ├── 1a. Extend shared types (PendingApproval, new SSE events)
  ├── 1b. Add requiresApproval flag to tool definitions
  └── 1c. Refactor tools/index.ts to support the flag

Phase 2: Server-Side Approval Mechanics
  ├── 2a. Build ApprovalManager service
  ├── 2b. Modify ChatService loop for pause/resume
  ├── 2c. Add /api/chat/approve endpoint
  └── 2d. Add pending_approvals DB table (persistence/history)

Phase 3: First Write Tools (start with one, prove the pattern)
  ├── 3a. Extend LinearGraphqlClient with createIssue mutation
  ├── 3b. Build create_issue write tool with handler + describeAction
  └── 3c. End-to-end test: model proposes → approval → execute

Phase 4: Frontend Approval UI
  ├── 4a. Handle approval_request SSE event in ChatPage
  ├── 4b. Build ApprovalCard component
  ├── 4c. Wire approve/decline buttons to POST /api/chat/approve
  └── 4d. Handle approval_resolved event (update card state)

Phase 5: Expand Write Tools
  ├── 5a. Linear mutations: update issue, assign, change status, comment
  ├── 5b. Linear workflow: create project, manage cycles, labels
  ├── 5c. GitHub actions: create issue, create PR, request review
  └── 5d. Internal: create/update OKRs and key results
```

**Why this order:**
- Phase 1 before 2: Types must exist before the manager can use them.
- Phase 2 before 3: The pause/resume mechanism must work before write tools make sense.
- Phase 3 before 4: Server-side proof with a single tool validates the architecture before building UI.
- Phase 3 before 5: Prove the pattern with one tool before scaling to many.
- Phase 4 can partially overlap with Phase 3 (start card component while testing server-side).

## Sources

- [OpenAI Agents SDK: Human-in-the-Loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/) - Interruption/resume pattern, needsApproval, state management (HIGH confidence)
- [Google Cloud: Agentic AI Design Patterns](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system) - Human-in-the-loop checkpoint pattern (HIGH confidence)
- [LangGraph: Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) - Pause/resume with checkpointers, in-node interrupt pattern (MEDIUM confidence, adapted from Python concepts)
- [AG-UI: Core Architecture](https://docs.ag-ui.com/concepts/architecture) - Event-driven client-server model, typed event categories (MEDIUM confidence)
- [Permit.io: Human-in-the-Loop Best Practices](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo) - Framework-agnostic HITL patterns (MEDIUM confidence)
- Existing codebase analysis: `chatService.ts`, `tools/index.ts`, `chat.ts`, `ChatPage.tsx`, shared types (HIGH confidence - direct code review)

---
*Architecture research for: AI chat approval-gated action execution*
*Researched: 2026-02-12*
