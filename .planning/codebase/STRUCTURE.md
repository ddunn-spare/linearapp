# Codebase Structure

**Analysis Date:** 2026-02-12

## Directory Layout

```
linearapp/
├── apps/
│   ├── server/              # Backend: Node.js + Fastify + SQLite
│   │   ├── src/
│   │   │   ├── main.ts      # Entry point, server startup
│   │   │   ├── app.ts       # Fastify app factory, route registration
│   │   │   ├── config.ts    # Configuration loading from env/files
│   │   │   ├── db.ts        # SQLite schema and query methods
│   │   │   ├── adapters/    # External API clients
│   │   │   ├── services/    # Business logic and sync orchestration
│   │   │   ├── routes/      # HTTP endpoint handlers
│   │   │   ├── lib/         # Shared utilities (logger, dateUtils, branchMatcher)
│   │   │   └── tools/       # Chat AI function definitions
│   │   ├── dist/            # Compiled output (TypeScript → JavaScript)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                 # Frontend: React 19 + Vite + Material-UI
│       ├── src/
│       │   ├── main.tsx     # React root entry
│       │   ├── App.tsx      # Route definitions
│       │   ├── api.ts       # Fetch client wrapper for all endpoints
│       │   ├── theme.ts     # Material-UI theme (dark mode)
│       │   ├── components/  # Reusable UI components
│       │   └── pages/       # Route-level page containers
│       ├── dist/            # Built output
│       ├── index.html       # HTML entry point
│       ├── package.json
│       ├── vite.config.ts   # Vite config with API proxy
│       └── tsconfig.json
│
├── packages/
│   └── shared/              # Shared TypeScript types
│       ├── src/
│       │   └── index.ts     # All domain types exported
│       ├── dist/            # Compiled types
│       ├── package.json
│       └── tsconfig.json
│
├── skills/                  # Conversational AI skill definitions (Linear PM Agent)
├── .linear-pm-agent/        # Local state for Linear PM agent (generated)
├── .planning/               # Planning documents (this file)
├── .env                     # Environment configuration (SECRET - not committed)
├── .env.example             # Template for environment variables
├── team.config.json         # Team member tracking configuration
├── tsconfig.base.json       # Base TypeScript configuration (shared by all)
├── package.json             # Root workspace configuration
├── package-lock.json        # Dependency lock
└── README.md
```

## Directory Purposes

**apps/server/src/:**
- **main.ts** - Server startup. Loads config, creates Fastify app, handles graceful shutdown (SIGINT/SIGTERM/uncaught exceptions).
- **app.ts** - Application factory. Instantiates all adapters, services, and routes. Sets up CORS, error handlers, background job intervals, and cleanup hooks.
- **config.ts** - Configuration loader. Searches for .env file from launch directory upward. Loads environment variables, team.config.json, and sets defaults. Exports typed `config` object.
- **db.ts** - SQLite database. 789 lines. Defines schema (11+ tables) and all query methods. Single responsibility: state persistence and retrieval. No business logic.

**apps/server/src/adapters/:**
- **linearGraphql.ts** - Linear GraphQL client. Wraps API calls with timeout, auth headers, error unwrapping. Exports async methods like `listStatuses()`, `listIssues()`, `updateIssueStatus()`. Transforms Linear types (LinearUser, LinearIssue) to internal types.
- **githubClient.ts** - GitHub REST client. Fetches pull requests and reviews from configured repositories. Links PRs to Linear issues via branch name patterns.
- **openaiClient.ts** - OpenAI chat completions client. Streams responses and handles function calling. Wraps OpenAI SDK.

**apps/server/src/services/:**
- **linearSyncService.ts** (131 lines) - Syncs issues, members, cycles from Linear API to SQLite. Transforms data (e.g., Linear statusType → BoardColumnId). Preserves enrichments across syncs.
- **githubSyncService.ts** - Fetches PR/review data from GitHub, links to Linear issues.
- **syncService.ts** (SyncOrchestrator) - Orchestrates linear and GitHub syncs. Called by background job and manual trigger. Tracks sync status in DB.
- **chatService.ts** (146 lines) - Manages chat conversations. Implements OpenAI function-calling loop: send message with tools → receive tool calls → execute tool handlers → feed results back → repeat up to 5 times. Persists messages.
- **enrichmentService.ts** (98 lines) - AI-driven issue enrichment. Calls OpenAI to generate RICE scores, recommend assignees, find OKR links. Caches results.

**apps/server/src/routes/:**
Each file registers endpoint(s) for a domain. Pattern: `export function registerXxxRoutes(app: FastifyInstance, ...dependencies) { app.get/post/patch(...) }`

- **board.ts** - GET `/api/board` (board state), PATCH `/api/board/move` (card movement), GET/PUT `/api/board/wip-limits`.
- **issues.ts** - GET `/api/issues` (filtered/searched), GET `/api/issues/:id`, PATCH `/api/issues/:id/rice`, POST `/api/issues/bulk` (bulk actions).
- **cycles.ts** - GET `/api/cycles`, GET `/api/cycles/active` (active cycle detail with burndown and member breakdown), GET `/api/cycles/:id`.
- **okrs.ts** - GET/POST `/api/okrs`, GET/PUT/DELETE `/api/okrs/:id`, PATCH `/api/okrs/key-results/:krId`, GET `/api/okrs/allocation` (OKR allocation view).
- **chat.ts** - GET `/api/chat/conversations`, POST `/api/chat` (SSE streaming), GET `/api/chat/conversations/:id/messages`, POST/DELETE `/api/chat/conversations`.
- **members.ts** - GET `/api/members`, GET/POST/PUT/DELETE `/api/members/:id`.
- **dashboard.ts** - GET `/api/dashboard` (stats and member cards).
- **overview.ts** - GET `/api/overview` (velocity and shipped issues), POST `/api/overview/summary` (AI summary).
- **github.ts** - GET `/api/github/prs` (filtered pull requests).
- **sync.ts** - GET `/api/sync/status`, POST `/api/sync/refresh` (manual sync).
- **health.ts** - GET `/api/health` (liveness check).

**apps/server/src/lib/:**
- **logger.ts** - Logger factory. Returns configured Fastify logger instance with structured JSON output.
- **dateUtils.ts** - ISO date parsing and manipulation utilities.
- **branchMatcher.ts** - Regex patterns to extract Linear issue IDs from GitHub branch names (e.g., "EAM-123-feature" → "EAM-123").

**apps/server/src/tools/:**
- **index.ts** (354 lines) - Chat AI tool definitions and handlers. Defines 20+ tools like `search_issues`, `list_members`, `check_wip_capacity`, `update_assignment`, `allocate_to_okr`, `update_issue_status`. Each tool: JSON schema (input/output) + handler function that queries DB or calls adapters.

**apps/web/src/:**
- **main.tsx** - React 19 bootstrap. Creates root, renders App component.
- **App.tsx** - React Router root. Defines route structure: `/` (TeamPage), `/team/:id` (MemberDetailPage), `/okrs` (OkrPage), `/chat` (ChatPage).
- **api.ts** (139 lines) - Fetch client wrapper. Exports typed functions for all endpoints: `getDashboard()`, `getMembers()`, `getBoard()`, `streamChat()`, etc. Base URL `/api` proxied by Vite dev server to backend.
- **theme.ts** - Material-UI dark theme config. Color palette, typography.

**apps/web/src/components/:**
- **AppLayout.tsx** - Layout wrapper. Sidebar + main content area.
- **Sidebar.tsx** (275 lines) - Navigation with member status cards, nav links.
- **StatusChip.tsx** - Renders issue status badge.
- **PriorityIcon.tsx** - Renders priority indicator.
- **AgeIndicator.tsx** - Shows how long issue has been in current status.
- **LoadingState.tsx** - Loading skeleton/spinner.
- **ErrorAlert.tsx** - Error message display.

**apps/web/src/pages/:**
- **TeamPage.tsx** (69 lines) - Team overview. Lists tracked members with WIP counts.
- **MemberDetailPage.tsx** (145 lines) - Member detail. Shows member's issues, pull requests, reviews.
- **BoardPage.tsx** (185 lines) - Kanban board. Draggable columns with WIP limits. Uses `@dnd-kit`.
- **BacklogPage.tsx** (220 lines) - Backlog view with filtering/sorting.
- **CyclePage.tsx** (126 lines) - Cycle progress, burndown chart, member breakdown, rollover risk.
- **OkrPage.tsx** (256 lines) - OKR list, CRUD, key results, allocation view.
- **ChatPage.tsx** (335 lines) - Chat interface. Conversation list, message history, SSE streaming.
- **DashboardPage.tsx** (129 lines) - Dashboard with stats cards and member status.
- **OverviewPage.tsx** (272 lines) - Velocity dashboard. Shows shipped issues, member velocity trends, category breakdown.

**packages/shared/src/:**
- **index.ts** - Single file, 408 lines. Exports 50+ types:
  - Views: `IssueView`, `BoardColumnId`, `SyncMode`, `AiProvider`
  - Team: `TeamMember`, `TrackedMember`, `TrackedMemberStatus`, `CapacitySignals`
  - Issues: `IssueSnapshot`, `IssueEnrichment`, `IssueDraft`, `IssueWithState`, `RiceScore`
  - Cycles: `Cycle`, `CycleDetail`, `BurndownPoint`, `CycleMemberBreakdown`, `RolloverRiskItem`
  - OKRs: `KeyResult`, `OkrDoc`, `OkrInput`, `OkrAllocationView`
  - PRs: `PullRequest`, `PrReview`, `PrReviewStatus`
  - Board: `BoardState`, `BoardColumn`, `WipLimit`, `BoardMoveRequest`, `BoardMoveResult`
  - Chat: `ChatConversation`, `ChatMessage`, `ChatToolCall`, `ChatStreamEvent`
  - API: Response wrappers, enums, type unions

## Key File Locations

**Entry Points:**
- `apps/server/src/main.ts` - Server startup
- `apps/web/src/main.tsx` - React bootstrap
- `apps/web/src/App.tsx` - Route definitions

**Configuration:**
- `apps/server/src/config.ts` - App configuration loader
- `team.config.json` - Tracked members configuration (root)
- `.env` - Environment variables (not committed)
- `.env.example` - Template (committed)
- `vite.config.ts` - Web dev server configuration

**Database & State:**
- `apps/server/src/db.ts` - SQLite schema and query methods
- `.linear-pm-agent/state.db` - Runtime SQLite database file (generated)

**Core Logic:**
- `apps/server/src/app.ts` - Application factory and route registration
- `apps/server/src/services/` - All business logic services
- `apps/server/src/adapters/` - External API clients
- `apps/web/src/api.ts` - Client-side API wrapper

**Testing:**
- `apps/server/` - No test directory (vitest configured but no test files)
- `apps/web/` - No test directory (no tests configured)

## Naming Conventions

**Files:**
- TypeScript source: `.ts` or `.tsx`
- Services/adapters: PascalCase (e.g., `ChatService`, `LinearGraphqlClient`)
- Routes: kebab-case (e.g., `chat.ts`, `board.ts`)
- Config/utilities: kebab-case (e.g., `branch-matcher.ts`)
- Pages/components: PascalCase (e.g., `TeamPage.tsx`, `Sidebar.tsx`)

**Directories:**
- Domain layers: kebab-case (e.g., `adapters/`, `services/`, `routes/`)
- Feature groups: kebab-case (e.g., `components/`, `pages/`)
- Packages: kebab-case with scoped naming (e.g., `@linearapp/shared`)

**Functions:**
- Service methods: camelCase (e.g., `syncAll()`, `handleMessage()`)
- Route handlers: declared inline with HTTP method (e.g., `app.get()`, `app.post()`)
- Tool handlers: camelCase (e.g., `searchIssues`, `updateAssignment`)

**Types:**
- Domain objects: PascalCase (e.g., `IssueSnapshot`, `ChatMessage`, `OkrDoc`)
- Enums/unions: PascalCase (e.g., `BoardColumnId`, `IssueView`)
- Internal types: PascalCase (e.g., `LinearStatus`, `LinearCycle`)

**Constants:**
- Configuration: `UPPERCASE` (e.g., `SYSTEM_PROMPT`, `MAX_ITERATIONS`)
- Data constants: camelCase or lowercase (e.g., `columnIds`, `columnLabels`)

## Where to Add New Code

**New Feature (e.g., Reports, Notifications):**
- Core logic: `apps/server/src/services/[feature]Service.ts`
- HTTP endpoints: `apps/server/src/routes/[feature].ts`
- Chat tools (if AI-accessible): Add to `apps/server/src/tools/index.ts`
- Database: Add tables to `db.ts` schema and add query methods to `StateDb` class
- Shared types: Add to `packages/shared/src/index.ts`
- Frontend page: `apps/web/src/pages/[Feature]Page.tsx`
- API wrapper: Add fetch wrapper to `apps/web/src/api.ts`

**New API Integration (e.g., Slack, Linear Webhooks):**
- Client adapter: `apps/server/src/adapters/[service]Client.ts`
- If sync-based: Add service in `apps/server/src/services/` and call from `syncService.ts`
- If webhook-based: Add route in `apps/server/src/routes/webhooks.ts` (create if needed)
- Register route: Call `registerXxxRoutes()` from `app.ts`

**New Component/UI Element:**
- Reusable: `apps/web/src/components/[ComponentName].tsx`
- Page-specific: Keep in page file or create subdirectory `apps/web/src/pages/[feature]/[component].tsx`
- Styling: Use Material-UI `sx` prop inline; theme in `theme.ts` for global changes

**Utilities/Helpers:**
- Server: `apps/server/src/lib/[utility].ts` if cross-cutting (used by multiple services/routes)
- Client: Consider adding to `apps/web/src/` if needed, or inline if single-use
- Shared: `packages/shared/src/index.ts` only if types, not logic

**Chat AI Tools:**
- Definition + handler: Add to tool definitions array in `apps/server/src/tools/index.ts`
- Tool must export schema (input/output) and handler function
- Handler can query DB, call adapters, or mutate state
- No async generators or streaming from tools

## Special Directories

**`.linear-pm-agent/` (Generated by Linear PM Agent):**
- Purpose: Local state directory for agent runs
- Generated: Yes, at runtime
- Committed: No (in .gitignore)
- Contents:
  - `state.db` - SQLite database (runtime)
  - `context/okrs/` - OKR files
  - `context/issues/` - Issue context files
  - `logs/jobs/` - Job execution logs

**`.planning/codebase/` (This Project):**
- Purpose: Architecture and design documents
- Generated: No (manually created/maintained)
- Committed: Yes
- Contents: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md

**`dist/` directories:**
- Purpose: Compiled TypeScript output
- Generated: Yes, by `npm run build` (tsc) and `npm run dev` (tsx/vite watches)
- Committed: No (in .gitignore)
- Cleanup: Delete with `rm -rf apps/*/dist packages/*/dist`

**`node_modules/`:**
- Purpose: Installed dependencies
- Generated: Yes, by `npm install`
- Committed: No (in .gitignore)
- Install: `npm install` at repo root (installs all workspace packages)

---

*Structure analysis: 2026-02-12*
