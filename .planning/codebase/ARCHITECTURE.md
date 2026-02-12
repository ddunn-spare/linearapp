# Architecture

**Analysis Date:** 2026-02-12

## Pattern Overview

**Overall:** Layered monorepo with workspace separation (server, web, shared). The backend uses a three-layer pattern: adapters → services → HTTP routes. The frontend is React-based with component/page organization. Data flows from external APIs (Linear, GitHub, OpenAI) through the server's synchronization and caching layer into SQLite, then served via REST/SSE to the web client.

**Key Characteristics:**
- Monorepo using npm workspaces with separate `apps/` (server, web) and `packages/` (shared types)
- Event-driven synchronization with background polling jobs
- SQLite as local state cache with full schema
- REST API with Server-Sent Events (SSE) for real-time chat streaming
- Layered server architecture: adapters (external integrations) → services (business logic) → routes (HTTP endpoints)
- Type-safe shared types across workspace packages
- Configuration-driven team member tracking and API credentials

## Layers

**Adapters Layer:**
- Purpose: Encapsulate external API clients and handle protocol differences
- Location: `apps/server/src/adapters/`
- Contains: Linear GraphQL client, GitHub REST client, OpenAI client
- Depends on: Configuration, types from `@linearapp/shared`
- Used by: Services (linear sync, GitHub sync, chat, enrichment)
- Key files:
  - `linearGraphql.ts` - Linear GraphQL API queries and data mapping
  - `githubClient.ts` - GitHub REST API for pull requests and reviews
  - `openaiClient.ts` - OpenAI chat completions with streaming support

**Services Layer:**
- Purpose: Implement business logic, orchestration, and state management
- Location: `apps/server/src/services/`
- Contains: Sync orchestrators, chat service with tool handling, enrichment logic
- Depends on: Adapters, database, config
- Used by: Routes and background jobs
- Key files:
  - `linearSyncService.ts` - Syncs issues, members, cycles from Linear to SQLite; transforms Linear types to internal snapshots
  - `githubSyncService.ts` - Pulls PR and review data from GitHub
  - `syncService.ts` - SyncOrchestrator coordinates linear and GitHub syncs
  - `chatService.ts` - Manages chat conversations with OpenAI function calling and tool execution
  - `enrichmentService.ts` - AI-driven issue enrichment (RICE scores, assignments, OKR matching)

**Routes Layer (HTTP Endpoints):**
- Purpose: Define REST API endpoints and handle request/response serialization
- Location: `apps/server/src/routes/`
- Contains: Endpoint handlers for all major features (board, issues, cycles, OKRs, chat, etc.)
- Depends on: Services, database, adapters
- Used by: Web frontend via fetch
- Key files organize by domain:
  - `board.ts` - Board state, column WIP limits, card movement
  - `issues.ts` - Issue queries and bulk actions
  - `cycles.ts` - Cycle details, member breakdown, rollover risk
  - `okrs.ts` - OKR CRUD and allocation views
  - `chat.ts` - Chat message streaming, conversation management
  - `members.ts` - Team member CRUD and statistics
  - `overview.ts` - Velocity calculations and shipped issue categorization
  - `dashboard.ts` - Dashboard stats aggregation
  - `github.ts` - PR querying with filters
  - `sync.ts` - Manual sync trigger and status
  - `health.ts` - Health checks

**Database Layer:**
- Purpose: SQLite local state storage with type-safe accessors
- Location: `apps/server/src/db.ts`
- Contains: Schema definition (11+ tables), CRUD operations for all domain objects
- Key responsibilities:
  - Maintains issue snapshots with enrichment and draft state
  - Tracks sync state and job history
  - Stores OKRs and key results with issue linking
  - Caches team members, pull requests, reviews
  - Manages chat conversations and messages
  - Persists WIP limits and board state

**Libraries/Utilities:**
- Purpose: Cross-cutting concerns and helpers
- Location: `apps/server/src/lib/`
- Contains:
  - `logger.ts` - Structured logging via Fastify
  - `dateUtils.ts` - ISO date parsing and manipulation
  - `branchMatcher.ts` - GitHub branch-to-Linear-issue linking

**Tools Layer:**
- Purpose: Chat service function definitions and implementations
- Location: `apps/server/src/tools/index.ts`
- Contains: 20+ tool definitions (search issues, check capacity, update assignments, etc.) with handlers
- Enables: AI assistant to query and modify work items

**Shared Types Package:**
- Purpose: Single source of truth for domain types across server and client
- Location: `packages/shared/src/index.ts`
- Exports: 50+ types covering issues, cycles, OKRs, members, PRs, chat, board state, etc.
- Consumed by: Both `@linearapp/server` and `@linearapp/web`

**Frontend Layers (React):**
- Purpose: UI rendering and client-side state management
- Location: `apps/web/src/`
- Components:
  - `components/` - Reusable UI primitives (StatusChip, PriorityIcon, Sidebar, AppLayout)
  - `pages/` - Route-level containers (TeamPage, BoardPage, CyclePage, ChatPage, etc.)
  - `api.ts` - Fetch-based API client with typed wrappers
  - `theme.ts` - Material-UI dark theme configuration

## Data Flow

**Linear Synchronization (Background Job):**

1. Background interval triggers every 15 minutes (configurable `BACKGROUND_REFRESH_MS`)
2. `SyncOrchestrator.syncAll()` → `LinearSyncService.sync()`
3. LinearSyncService queries Linear API (GraphQL):
   - Fetches team members, statuses, issues, cycles
   - Transforms Linear types (LinearUser, LinearIssue, etc.) to internal snapshots (TeamMember, IssueSnapshot, Cycle)
   - Maps Linear status types to board columns (e.g., "started" → "in_progress")
4. Data written to SQLite via `StateDb` methods
5. Subsequent syncs update existing records, preserving enrichments and drafts
6. Job result logged to sync_state table

**GitHub Pull Request Sync (Separate Job):**

1. Runs every 5 minutes independently
2. `GitHubSyncService.sync()` queries repositories defined in `GITHUB_REPOS` config
3. Maps PR branches to Linear issues via pattern matching (`branchMatcher.ts`)
4. Stores PR and review data in pull_requests and pr_reviews tables

**Chat Flow (Real-time SSE):**

1. User sends message → `/api/chat` POST endpoint
2. `ChatService.handleMessage()` invoked:
   - Retrieves conversation history from database
   - Sends system prompt + conversation to OpenAI with tool definitions
   - OpenAI returns tool_call requests
   - Service executes tool handlers (e.g., search_issues, update_assignment)
   - Tools query database or call adapters
   - Tool results fed back to OpenAI in loop (max 5 iterations)
   - Final response streamed to client as Server-Sent Events
3. Events sent line-delimited JSON: `data: {type, content}\n\n`
4. Messages and tool calls persisted to chat tables
5. Client receives events, updates UI incrementally

**Board Card Movement:**

1. User drags card to new column → `/api/board/move` PATCH request
2. Route handler validates:
   - WIP limit not exceeded on target column
   - Issue exists and is accessible
3. Column updates call `LinearGraphqlClient.updateIssueStatus()` to Linear API
4. Status writeback maps board column back to Linear status_type
5. Next sync cycle pulls the change from Linear

**Enrichment:**

1. User or admin requests issue enrichment → `/enrich/:issueId` POST
2. `EnrichmentService.enrichIssue()` calls OpenAI with:
   - Issue summary (title, description, labels)
   - Similar issues from database
   - Team member list for assignment suggestions
3. OpenAI returns RICE score, recommended assignee, OKR links, difficulty
4. Result cached in issue_enrichments table
5. Enrichment hydrated when issue is fetched

**State Management:**
- **Server:** SQLite as single source of truth, served via REST
- **Client:** React component state + fetch from server on route change
- **Sync:** Append-only with merge logic; enrichments preserved across syncs
- **Chat:** Persistent conversation history in database, real-time events over SSE
- **Drafts:** Stored separately from snapshots; can be reverted or committed to Linear

## Key Abstractions

**IssueWithState:**
- Purpose: Complete issue context combining snapshot, enrichment, draft, and PRs
- Type: `{ snapshot: IssueSnapshot; enrichment?: IssueEnrichment; draft?: IssueDraft; hasPendingChanges: boolean; pullRequests?: PullRequest[] }`
- Used by: Routes (board, issues, cycles), frontend pages
- Pattern: Clients request this composite type; service assembles from database joins

**Snapshot Pattern:**
- Purpose: Immutable point-in-time data from Linear, separate from user edits
- Types: IssueSnapshot, Cycle, TeamMember
- Benefit: Preserves original Linear state; drafts layer on top without mutation
- Synced: Continuously updated from Linear; users cannot edit directly

**Tool Handler Registry:**
- Purpose: Extensible command system for chat AI
- Location: `apps/server/src/tools/index.ts`
- Pattern: Tool definitions (JSON schema) + handler functions that mutate state or query DB
- Example tools: search_issues, update_assignment, check_wip_capacity, allocate_to_okr
- Used by: ChatService function-calling loop

**Board Column Mapping:**
- Purpose: Unified board model independent of Linear status types
- Types: `BoardColumnId` = "backlog" | "todo" | "in_progress" | "in_review" | "done"
- Mapping: Linear statusType → BoardColumnId (e.g., "unstarted" → "todo", "started" → "in_progress")
- Rationale: Linear status types vary by team; board columns are standard

**Cycle-Aware Filtering:**
- Purpose: Scope work to active or past cycles
- Pattern: Routes compute cycle progress, member breakdown, rollover risk
- Uses: burndown calculation, issue assignment to cycles, velocity tracking

## Entry Points

**Server:**
- Location: `apps/server/src/main.ts`
- Triggers: Fastify app initialization in `createApp()` (from `app.ts`)
- Responsibilities:
  - Load config from environment and .env files
  - Graceful shutdown handling for SIGINT/SIGTERM
  - Server listen on port (default 7917)
  - Sets up health check and background sync intervals

**Application Setup (app.ts):**
- Initializes all adapters (Linear, GitHub, OpenAI)
- Initializes all services (sync, chat, enrichment)
- Registers all route handlers
- Sets up CORS, error handlers, not-found handler
- Starts background sync jobs (Linear every 15m, GitHub every 5m)
- Handles graceful shutdown (close DB, clear intervals)

**Web Frontend:**
- Location: `apps/web/src/main.tsx`
- Bootstrap: React 19 with StrictMode, MUI ThemeProvider, React Router
- Root: `App.tsx` - Route definitions and layout
- Default route: `/` → TeamPage

**Health Endpoint:**
- Path: `/api/health`
- Returns: `{ status: "ok", mode: "api" }` or error if Linear/database unavailable
- Used by: Orchestrators to verify app readiness

## Error Handling

**Strategy:** Layered with fallbacks. Adapters throw; services catch and log; routes return 4xx/5xx HTTP responses.

**Patterns:**

**Adapter Level (LinearGraphqlClient):**
```typescript
// Query wrapper with timeout and error unwrapping
private async query<TData>(query: string, variables: Record<string, unknown>): Promise<TData> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), this.cfg.linearApiTimeoutMs);
  try {
    const response = await fetch(..., { signal: controller.signal });
    if (!response.ok) throw new Error(`Linear API ${response.status}`);
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(`Linear GQL: ${payload.errors.map(e => e.message).join("; ")}`);
    return payload.data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error(`Linear API timed out after ${this.cfg.linearApiTimeoutMs}ms`);
    throw new Error(`Linear API request failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}
```

**Service Level (ChatService):**
```typescript
try {
  const { events } = await chatService.handleMessage(conversationId, message);
  // Success path
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : "Chat failed";
  // Send error event to client
  reply.raw.write(`data: ${JSON.stringify({ type: "error", error: errorMsg })}\n\n`);
}
```

**Route Level:**
```typescript
app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, "Unhandled route error");
  const statusCode = typeof err.statusCode === "number" ? err.statusCode : 500;
  return reply.status(statusCode >= 400 && statusCode <= 599 ? statusCode : 500).send({
    ok: false,
    error: err.message || "Internal server error",
    ...(cfg.exposeErrorDetails ? { stack: err.stack } : {}),
  });
});
```

**Sync Failures:**
- Logged but non-blocking (next interval retries)
- Job status tracked in DB for monitoring

**Missing Configs:**
- Linear API key: Syncs disabled, routes return "not configured"
- GitHub token: PR sync skipped
- OpenAI key: Chat and enrichment unavailable
- App runs in degraded mode but doesn't crash

## Cross-Cutting Concerns

**Logging:**
- Tool: Fastify built-in logger (via `app.log`)
- Pattern: `log.info/error/warn({ context }, "message")`
- Location: `apps/server/src/lib/logger.ts` exports `createLogger(module)` factory
- Structured JSON output with context fields

**Validation:**
- Tool: Zod for request bodies
- Pattern: `z.object({...}).safeParse(request.body)`
- Location: Each route file
- Returns 400 with error message if validation fails

**Authentication:**
- Current: Environment variable API keys (LINEAR_API_KEY, GITHUB_TOKEN, OPENAI_API_KEY)
- CORS: Configurable via `CORS_ORIGIN` env var (defaults to localhost:7923)
- No user authentication; assumes trusted environment

**Type Safety:**
- TypeScript strict mode enabled globally
- Shared types in `@linearapp/shared` ensure server/client consistency
- Routes use type annotations for request/response payloads
- Database query methods return typed results

**Configuration:**
- Centralized: `apps/server/src/config.ts`
- Sources: Environment variables, .env file, team.config.json
- Schema:
  - App ports and CORS
  - API keys (Linear, GitHub, OpenAI)
  - Linear team key and sync intervals
  - Tracked members list (from team.config.json)
  - State directory path for SQLite and context files

**Concurrency Control:**
- Sync jobs guard against duplicate runs: `if (linearSyncRunning) return`
- Database: SQLite transactions with SERIALIZABLE isolation
- No explicit mutex; intervals stagger (Linear 15m, GitHub 5m)

---

*Architecture analysis: 2026-02-12*
