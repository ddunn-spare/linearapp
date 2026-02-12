# External Integrations

**Analysis Date:** 2026-02-12

## APIs & External Services

**Linear Issue Management (Primary):**
- Linear GraphQL API - Complete team backlog, cycles, issue metadata, and user sync
  - Client: `apps/server/src/adapters/linearGraphql.ts` (LinearGraphqlClient)
  - Auth: `LINEAR_API_KEY` environment variable (bearer token)
  - Endpoint: https://api.linear.app/graphql
  - Timeout: 20 seconds (configurable via `LINEAR_API_TIMEOUT_MS`)
  - Status: Optional (app functions in local-only mode without it)

**AI Enrichment & Chat (Optional):**
- OpenAI Chat Completions API - Issue enrichment, assignee recommendations, OKR mapping, AI chat
  - Client: `apps/server/src/adapters/openaiClient.ts` (OpenAIClient)
  - Auth: `OPENAI_API_KEY` environment variable (bearer token)
  - Model: gpt-4o (configurable via `OPENAI_MODEL`)
  - Features:
    - Streaming chat completions with tools support
    - JSON response generation with fallback heuristics
    - Temperature: 0.3 (structured), 0.2 (JSON)
  - Status: Optional (graceful degradation without key)

**GitHub PR Integration (Optional):**
- GitHub REST API - Pull request fetching, review status, branch-to-issue linking
  - Client: `apps/server/src/adapters/githubClient.ts` (GithubClient)
  - Auth: `GITHUB_TOKEN` environment variable (personal access token)
  - Features:
    - List all PRs across configured repos (per_page: 100)
    - Fetch PR reviews for review status derivation
    - Match branch names to Linear issue identifiers (e.g., `EAM-123-feature`)
  - Configuration:
    - `GITHUB_ORG` - Organization owner
    - `GITHUB_REPOS` - Comma-separated list of repositories
  - Status: Optional (skipped if token/org/repos not configured)

## Data Storage

**Databases:**
- SQLite 3 (via better-sqlite3 11.8.1)
  - Location: `~/.linear-pm-agent/state.db` (configurable via `LINEAR_PM_STATE_ROOT`)
  - Purpose: Persistent storage of synced issues, team members, cycles, OKRs, PRs, chat history
  - Connection: Direct file-based (no server)
  - Client: better-sqlite3 (synchronous)
  - Tables:
    - `team_members` - Team roster with Linear user IDs and GitHub usernames
    - `issues` - Complete issue snapshots with status, assignee, estimates, labels
    - `cycles` - Linear sprint/cycle data
    - `okrs` - Objectives and key results with progress tracking
    - `key_results` - Individual KRs linked to OKRs
    - `pull_requests` - GitHub PR metadata with review status
    - `pr_reviews` - Individual PR reviews with reviewer and state
    - `chat_conversations` - Persistent chat session history
    - `chat_messages` - Chat messages with role and content
    - `issue_enrichment` - AI-generated enrichment data (assignee candidates, difficulty, etc.)
    - `issue_views` - Custom issue groupings (backlog/in-progress/triage)
    - `issue_drafts` - Pending changes staged for write-back to Linear

**File Storage:**
- Local filesystem only (no cloud storage)
  - OKR markdown files: `~/.linear-pm-agent/context/okrs/*.md` (YAML frontmatter + markdown body)
  - Issue context files: `~/.linear-pm-agent/context/issues/*.md`
  - Job logs: `~/.linear-pm-agent/logs/jobs/*.jsonl` (JSON lines format)
  - Gray-matter parsing: `apps/server/src/adapters/linearGraphql.ts` uses gray-matter for YAML extraction

**Caching:**
- None (all data stored directly in SQLite with sync status tracking)
- Background refresh interval: 15 minutes (configurable via `BACKGROUND_REFRESH_MS`)

## Authentication & Identity

**Auth Providers:**
- No OAuth/SAML provider (local-first, no user accounts)
- Linear API: Direct API key authentication
- GitHub API: Personal access token authentication
- OpenAI API: API key authentication

**Implementation:**
- Environment variable-based configuration
- No session management or JWT tokens
- Credentials loaded once at server startup via dotenv
- Team member tracking via `team.config.json` with Linear user ID mapping
- CORS origin validation for frontend requests (configurable)

## Monitoring & Observability

**Error Tracking:**
- Not integrated (error details logged to stdout/stderr)

**Logs:**
- Fastify built-in logger
  - Level: Configurable via `LOG_LEVEL` (default: "info")
  - Output: Console (stdout)
  - Details: Includes request params/body context and stack traces for 5xx errors
  - Flag: `EXPOSE_ERROR_DETAILS=true` includes full stack in 500 responses

**Job Logging:**
- JSONL format stored at `~/.linear-pm-agent/logs/jobs/`
- Sync operations logged with timestamps and status

## CI/CD & Deployment

**Hosting:**
- Self-hosted only (local machine or server)
- No cloud platform integration

**CI Pipeline:**
- None detected (no GitHub Actions, GitLab CI, etc.)

**Build Output:**
- Server: CommonJS bundle at `apps/server/dist/main.js`
- Web: Static SPA bundle at `apps/web/dist/`

**Startup:**
- Server: `node dist/main.js` (listens on 0.0.0.0:{APP_PORT})
- Web: Served via Vite dev server during development (port 7923)
- Graceful shutdown: 10-second timeout for cleanup before forced exit

## Environment Configuration

**Required Environment Variables (for full features):**
- `LINEAR_API_KEY` - Linear GraphQL API authentication (required for sync/apply)
- `OPENAI_API_KEY` - OpenAI API key (required for AI enrichment, optional for UI)
- `GITHUB_TOKEN` - GitHub personal access token (required for PR sync)
- `GITHUB_ORG` - GitHub organization name
- `GITHUB_REPOS` - Comma-separated repo list

**Optional Environment Variables:**
- `LINEAR_TEAM_KEY` - Team identifier (default: "EAM")
- `APP_PORT` - Server port (default: 7917)
- `CORS_ORIGIN` - Frontend origin (default: http://localhost:7923)
- `VITE_WEB_PORT` - Frontend port (default: 7923)
- `VITE_API_BASE_URL` - API endpoint for frontend (default: http://localhost:7917)
- `LINEAR_API_URL` - Linear API endpoint (default: https://api.linear.app/graphql)
- `LINEAR_API_TIMEOUT_MS` - API request timeout (default: 20000)
- `LOG_LEVEL` - Fastify log level (default: "info")
- `EXPOSE_ERROR_DETAILS` - Include stack traces (default: false in prod)
- `BACKGROUND_REFRESH_MS` - Sync interval (default: 900000 = 15 minutes)
- `SYNC_ISSUE_LIMIT` - Max issues to sync (default: 500)
- `ASSIGNEE_HISTORY_DAYS` - Days to track assignee history (default: 180)
- `OPENAI_MODEL` - OpenAI model name (default: "gpt-4o")
- `LINEAR_PM_STATE_ROOT` - State directory (default: .linear-pm-agent at repo root)

**Secrets Location:**
- `.env` file at project root (gitignored)
- Never committed to version control
- Example template: `.env.example`

## Webhooks & Callbacks

**Incoming:**
- None detected (pull-based integrations only)

**Outgoing:**
- Linear API: Selective write-back via `/api/apply/:issueId` endpoints (user-initiated)
- Not automated webhooks (manual approval required in UI before changes sync to Linear)

**Event Flow (Chat/Operator Panel):**
- User message → ChatService → OpenAI completions → Tool calls parsed → Linear API mutations applied
- Tools defined in `apps/server/src/tools/index.ts` (not exposed as webhooks)

---

*Integration audit: 2026-02-12*
