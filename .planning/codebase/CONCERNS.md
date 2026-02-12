# Codebase Concerns

**Analysis Date:** 2026-02-12

## Tech Debt

**Type Safety: Excessive use of `any` type in database layer**
- Issue: Database query results are cast to `any` due to better-sqlite3 returning untyped rows. This bypasses TypeScript's type checking on row mappings.
- Files: `apps/server/src/db.ts` (48 instances of `as any[]` and `as any`)
- Impact: Silent bugs if column names change, field renamings break at runtime rather than compile time, difficult refactoring
- Fix approach: Create proper row types per query or use a query builder with typed results (e.g., migrate to drizzle-orm or kysely). Alternatively, implement type-safe row mappers with runtime validation.

**Type Safety: Untyped request/response casting**
- Issue: Routes cast `request.params`, `request.query`, and `request.body` to `{ id: string }` or similar without validation for params
- Files: `apps/server/src/routes/github.ts:6`, `apps/server/src/routes/chat.ts:14`, `apps/server/src/routes/members.ts:19`
- Impact: Invalid route parameters pass through with no error, potential crashes or incorrect data access
- Fix approach: Add zod validation for all route params (currently done for body, not for params/query). Create reusable param schemas.

**Type Safety: Tool call handling uses `any`**
- Issue: ChatService casts tool calls to `any` due to OpenAI SDK type complexity
- Files: `apps/server/src/services/chatService.ts:102`
- Impact: Tool name/arguments handling is fragile and untypeable
- Fix approach: Extract tool call parsing logic with explicit types or use discriminated unions

## Error Handling Gaps

**Silent catch blocks with no logging or fallback**
- Issue: Multiple catch blocks suppress errors entirely, making debugging difficult
- Files:
  - `apps/server/src/config.ts:41` - `catch { /* skip malformed */ }` on JSON parse - no logging of which config failed
  - `apps/server/src/db.ts:180` - `catch { return fallback; }` in safeJson - silent failures on corrupted data
  - `apps/server/src/adapters/linearGraphql.ts:79` - Cycles endpoint catch returns empty array with no indication of failure
  - `apps/server/src/adapters/openaiClient.ts:59` - `catch { return { result: null... }` silently drops errors
- Impact: Data corruption/misses go unnoticed, impossible to debug missing data, cascading failures without root cause visibility
- Fix approach: Replace silent catches with explicit error logging or error states. Use logger instead of silent fallback.

**GitHub API errors use console.error instead of structured logging**
- Issue: GithubClient fetches fail for individual repos silently
- Files: `apps/server/src/adapters/githubClient.ts:76` - `console.error`
- Impact: GitHub sync failures don't appear in application logs, impossible to alert on
- Fix approach: Use logger instance like other services instead of console.error

**Unhandled API request failures**
- Issue: Fetch requests in LinearGraphqlClient have timeout handling but no retry logic
- Files: `apps/server/src/adapters/linearGraphql.ts:30-53`
- Impact: Temporary network hiccups fail entire sync, no exponential backoff
- Fix approach: Implement retry with exponential backoff for transient failures

## Security Considerations

**Environment variable handling - missing validation**
- Issue: Config loads environment variables without type validation at startup. Missing required vars create silent null/undefined values.
- Files: `apps/server/src/config.ts`
- Impact: Application starts without LINEAR_API_KEY but silently skips all Linear functionality. No error on missing OPENAI_API_KEY.
- Recommendations: Add startup validation that throws if CRITICAL env vars are missing. Use zod for config schema validation.

**CORS too permissive in local dev**
- Issue: CORS fallback allows all origins for localhost
- Files: `apps/server/src/app.ts:55` - `callback(null, isAllowed || true)`
- Impact: In production if CORS_ORIGIN not properly set, any origin can access API. Comment suggests this is intentional for dev but is dangerous.
- Recommendations: Remove the `|| true` fallback. Never allow CORS to all in any environment. Require explicit origin list.

**No input sanitization on chat messages or bulk operations**
- Issue: Chat messages and bulk issue operations are passed directly to tools/database without sanitization
- Files: `apps/server/src/services/chatService.ts:50-56`, `apps/server/src/routes/issues.ts` (bulk operations)
- Impact: If chat system or database filters fail, unsanitized user input could be used in tool calls or database queries
- Recommendations: Add input validation/sanitization for chat message content. Validate all bulk operation inputs against current state.

**API keys passed in Authorization header without verification**
- Issue: Linear API key is trusted without validation
- Files: `apps/server/src/adapters/linearGraphql.ts:38`
- Impact: Invalid/compromised keys aren't caught until query execution
- Recommendations: Add health check during startup to validate API key connectivity

## Performance Bottlenecks

**N+1 queries in PR to issue linking**
- Issue: GithubSyncService loops through PRs and calls searchIssues for each one
- Files: `apps/server/src/services/githubSyncService.ts:23-30`
- Impact: 100 PRs = 100 database searches. With 5 repos x 100 PRs = 500 queries.
- Improvement path: Batch search - load all issues once, use in-memory lookup for linking

**Database transactions missing on batch operations**
- Issue: While upsertIssues uses transactions, other batch updates don't
- Files: `apps/server/src/db.ts` - OKR/cycle/PR upserts use implicit transactions only in specific methods
- Impact: If server crashes mid-batch, partial data persists. No atomicity guarantees.
- Improvement path: Wrap all multi-record operations in explicit transactions

**Chat history loads full message history on every request**
- Issue: getMessages fetches all messages every time, no pagination
- Files: `apps/server/src/services/chatService.ts:60`
- Impact: Old conversations get slower to load as history grows. Unbounded memory growth in message array.
- Improvement path: Implement pagination or message windowing. Load only recent messages for context.

**Enrichment service generates RICE for every issue in batch without throttling**
- Issue: enrichBatch calls OpenAI for each issue in sequence with no rate limiting
- Files: `apps/server/src/services/enrichmentService.ts` - not shown but referenced in app.ts
- Impact: Can hit OpenAI rate limits (3,500 requests/min) if enriching > 58 issues/second
- Improvement path: Add request queuing with configurable concurrency limits. Implement circuit breaker for API failures.

## Fragile Areas

**Board column state management**
- Files: `apps/server/src/routes/board.ts`, `apps/web/src/pages/BoardPage.tsx`
- Why fragile: Column state has hard-coded mappings between UI column IDs and Linear status types. Changing one breaks the other.
- Safe modification: Any status type change requires coordinating updates in `mapStatusToColumn` (linearSyncService), `columnToStatusType` (board.ts), and UI expectations
- Test coverage: No tests for status mapping consistency

**WIP limit enforcement without persistence check**
- Issue: WIP limit check doesn't verify if issue is actually in that column before moving
- Files: `apps/server/src/routes/board.ts:63`
- Impact: Race condition - two concurrent moves can bypass WIP limit if first hasn't committed yet
- Safe modification: Add optimistic lock or re-check WIP count just before write

**Cycle calculation depends on system timezone**
- Issue: Cycle active status uses `new Date()` which is client-dependent
- Files: `apps/server/src/services/linearSyncService.ts:43-46`
- Impact: If server and clients have different timezones, cycle active state differs
- Safe modification: Use explicit UTC dates for all comparisons. Store cycles as UTC-only.

## Scaling Limits

**SQLite database with single WAL file**
- Current capacity: Better-sqlite3 with WAL is suitable for ~10k issues, ~1k cycles, ~10k messages
- Limit: WAL file conflicts when concurrent writes exceed ~50 simultaneous requests. No read replicas.
- Scaling path: Migrate to PostgreSQL when data exceeds SQLite limits or concurrency > 10 simultaneous writers

**Background sync intervals hardcoded**
- Issue: Linear sync every 15 minutes, GitHub every 5 minutes regardless of team size
- Files: `apps/server/src/app.ts:154, 162`
- Impact: With 100+ issues, full sync takes 30+ seconds. Overlapping syncs can occur.
- Scaling path: Make intervals configurable. Add sync job queue with priority for manual vs background syncs.

**Chat function calling limited to 5 iterations**
- Issue: Max 5 tool call loops before assistant response finalized
- Files: `apps/server/src/services/chatService.ts:77-78`
- Impact: Complex multi-step queries fail silently if they need >5 iterations
- Scaling path: Increase limit or implement streaming updates so user sees progress

## Dependencies at Risk

**better-sqlite3 native dependency**
- Risk: Requires compilation during npm install. Breaking changes between major versions.
- Impact: v11 to v12 may break prepared statement behavior. Build failures on new Node versions.
- Migration plan: Consider TypeORM or Drizzle ORM for better abstraction and easier migration to PostgreSQL

**OpenAI SDK tight coupling**
- Risk: OpenAI SDK v6 to v7+ may change chat completion response types
- Impact: Tool calling logic depends on SDK message shape (currently cast to `any`)
- Migration plan: Create abstraction layer for OpenAI calls (openai adapter already exists but needs refinement)

**@octokit/rest deprecated for @octokit/graphql in newer versions**
- Risk: Rest API is frozen, GraphQL is recommended path forward
- Impact: Long-term maintainability if GitHub API deprecates REST endpoints
- Migration plan: Migrate PR fetching to GitHub GraphQL API

## Missing Critical Features

**No request rate limiting or DDoS protection**
- Problem: No rate limiting on endpoints. Malicious actors or runaway processes can hammer the API.
- Blocks: Safe public deployment, proper multi-tenant support
- Files: Fastify instance has no rate limiting plugin registered
- Recommended fix: Add @fastify/rate-limit with sliding window per IP

**No audit logging**
- Problem: No record of who changed what or when. Impossible to debug data inconsistencies.
- Blocks: Enterprise deployments, compliance requirements
- Impact: Board moves, issue changes, OKR edits leave no audit trail
- Recommended fix: Add audit log table with before/after snapshots

**No authentication/authorization**
- Problem: All API endpoints are public. No way to restrict access to specific teams or data.
- Blocks: Multi-tenant support, security in shared environments
- Impact: Any user can see/modify all issues and OKRs
- Recommended fix: Add JWT-based auth with team-level authorization checks

**No data retention policy**
- Problem: Chat messages and enrichments accumulate indefinitely
- Blocks: GDPR compliance, data minimization
- Impact: Chat database grows unbounded. No mechanism to delete old conversations.
- Recommended fix: Add configurable retention policies and cleanup jobs

## Test Coverage Gaps

**Database layer untested**
- What's not tested: All StateDb methods have no unit tests. Complex queries like getIssuesForView have no verification.
- Files: `apps/server/src/db.ts`
- Risk: Refactoring database layer breaks query behavior unnoticed. No regression tests for query logic.
- Priority: High - database is critical path

**API route handler integration tests missing**
- What's not tested: Routes are not tested with actual Fastify instance. No tests for request validation or error handling.
- Files: `apps/server/src/routes/*.ts`
- Risk: Breaking changes to route contracts don't fail CI. Zod validation logic is untested.
- Priority: High - routes are API contract

**Service layer integration tests sparse**
- What's not tested: SyncService orchestration, ChatService tool execution, EnrichmentService fallback behavior
- Files: `apps/server/src/services/*.ts`
- Risk: Sync failures and chat errors only caught in production
- Priority: Medium - services need E2E verification

**Frontend component tests missing**
- What's not tested: React pages have complex state management but no unit/integration tests
- Files: `apps/web/src/pages/*.tsx`
- Risk: UI breakages only caught manually. Refactoring components is error-prone.
- Priority: Medium - UI regressions affect user experience

**No browser/E2E tests**
- What's not tested: Full user workflows from login through board management and chat
- Risk: Breaking changes to API contracts only caught when users report issues
- Priority: Medium - need sanity checks for full workflows

---

*Concerns audit: 2026-02-12*
