# Coding Conventions

**Analysis Date:** 2026-02-12

## Naming Patterns

**Files:**
- Backend services: PascalCase with `.ts` extension (e.g., `LinearGraphqlClient.ts`, `SyncOrchestrator.ts`)
- Frontend components: PascalCase with `.tsx` extension (e.g., `AppLayout.tsx`, `StatusChip.tsx`)
- Utility modules: camelCase (e.g., `dateUtils.ts`, `logger.ts`)
- Route handlers: descriptive PascalCase or camelCase by domain (e.g., `issues.ts`, `board.ts`)
- Test files: `.test.ts` suffix (compiled from TypeScript)

**Classes:**
- PascalCase (e.g., `LinearGraphqlClient`, `StateDb`, `SyncOrchestrator`, `OpenAIClient`, `EnrichmentService`)
- Class names typically include domain context (Client, Service, Db, etc.)

**Functions:**
- camelCase for regular functions (e.g., `createLogger()`, `getStartOfWeek()`, `registerHealthRoutes()`)
- camelCase for exported utility functions (e.g., `daysBetween()`, `formatDate()`)
- PascalCase for component functions (React): `export default function AppLayout()` or named exports like `export default function StatusChip()`

**Types/Interfaces:**
- PascalCase (e.g., `LinearStatus`, `LinearUser`, `LinearCycle`, `LinearIssue`, `GraphQlResponse<T>`, `AppConfig`)
- Generic types use `T` prefix (e.g., `TData` in generic functions)
- Discriminated union types without suffix

**Variables:**
- camelCase for local variables (e.g., `response`, `statusCode`, `isAllowed`, `wipCount`)
- UPPER_SNAKE_CASE for constants (e.g., `SIDEBAR_WIDTH`, `SIDEBAR_COLLAPSED_WIDTH`)
- Private class members use camelCase with private keyword (e.g., `private readonly cfg: AppConfig`)

**Constants:**
- Numeric values with underscores for readability (e.g., `10_000`, `15 * 60 * 1000`, `20_000`)
- Used in timeouts, config values, and numeric literals

## Code Style

**Formatting:**
- No ESLint or Prettier config detected — code follows standard TypeScript conventions
- Target: ES2022
- Module resolution: NodeNext (ESM in web, CommonJS in server)
- Strict mode enabled (`"strict": true`)

**Linting:**
- TypeScript compiler flags:
  - `noUncheckedIndexedAccess: true` — enforces safe array/object indexing
  - `noUnusedLocals: true` — local variables must be used
  - `noUnusedParameters: true` — function parameters must be used
  - `exactOptionalPropertyTypes: false` — allows flexibility with optional properties
  - `forceConsistentCasingInFileNames: true` — case-sensitive file names on all platforms

**Type Safety:**
- `strict: true` — full type checking enabled
- All function parameters and return types explicitly typed
- Generic types used for polymorphism (e.g., `query<TData>()`, `request<T>()`)
- Type imports use `import type` syntax (e.g., `import type { BoardColumnId } from "@linearapp/shared"`)

## Import Organization

**Order:**
1. Node.js built-ins: `import fs from "node:fs"`, `import path from "node:path"`
2. Third-party libraries: `import Database from "better-sqlite3"`, `import Fastify from "fastify"`
3. Type imports: `import type { AppConfig }` on separate line from value imports
4. Internal modules: relative or absolute imports from `./`, `../`, `@linearapp/shared`

**Path Aliases:**
- `@linearapp/shared` — shared library (types, interfaces, constants)
- Relative paths used for local module imports

**Example from `/Users/devondunn/projects/linearapp/apps/server/src/app.ts`:**
```typescript
import Fastify from "fastify";
import cors from "@fastify/cors";
import type { AppConfig } from "./config";
import type { TrackedMemberStatus, BoardColumnId } from "@linearapp/shared";
import { StateDb } from "./db";
import { LinearGraphqlClient } from "./adapters/linearGraphql";
```

## Error Handling

**Patterns:**
- Try/catch blocks for async operations (e.g., in `OpenAIClient.generateJson()`)
- Error re-throwing with contextual message: `throw new Error(\`Linear API ${response.status}\`)`
- Fallback values on error (e.g., `generateJson()` returns `{ result: null, provider: "heuristic" }` on failure)
- Error logging includes structured data: `log.error("Sync failed", { error: message })`
- Custom error handling in routes using Fastify reply: `reply.status(400).send({ ok: false, error: ... })`
- Zod schema validation with `safeParse()` for input validation

**Response Format:**
```typescript
// Success
{ ok: true, ... }

// Error (HTTP routes)
{ ok: false, error: "message" }
```

**Async Error in Services:**
- Services throw errors which are caught at orchestrator level
- Orchestrator marks job end with success/failure: `db.markJobEnd(jobName, { success: false, error: message })`

## Logging

**Framework:** Custom logger module (`createLogger()` in `/Users/devondunn/projects/linearapp/apps/server/src/lib/logger.ts`)

**Implementation:**
- Functional logger factory: `const log = createLogger("ModuleName")`
- Methods: `info(msg, data?)`, `warn(msg, data?)`, `error(msg, data?)`
- Prefix format: `[ModuleName] message data`
- Data serialized to JSON when provided
- Uses `console.log`, `console.warn`, `console.error` under the hood

**Fastify Logger:**
- Built-in Fastify logger used: `app.log.info()`, `app.log.error()`
- Structured logging with objects: `app.log.error({ err: error }, "message")`

**Pattern from `/Users/devondunn/projects/linearapp/apps/server/src/services/syncService.ts`:**
```typescript
const log = createLogger("SyncOrchestrator");
// Usage:
log.error("Sync failed", { error: message });
```

## Comments

**When to Comment:**
- Business logic that is non-obvious (e.g., "Cycles are optional — don't fail sync")
- Complex calculations (e.g., RICE score formula)
- Integration points with external APIs

**JSDoc/TSDoc:**
- Not heavily used in codebase
- Type annotations used instead of JSDoc comments
- Return types and parameters explicitly typed

**Example from `/Users/devondunn/projects/linearapp/apps/server/src/adapters/linearGraphql.ts`:**
```typescript
// Cycles are optional — don't fail sync
return [];
```

## Function Design

**Size:**
- Most functions are concise (20-50 lines typical)
- Service methods 15-40 lines
- Private utility functions under 15 lines

**Parameters:**
- Explicit parameters typed individually
- Config objects destructured or passed as single object
- Generic type parameters used for polymorphism

**Return Values:**
- Explicitly typed return types required
- Async functions return Promise<T>
- Nullable returns use `T | null` or `T | undefined`
- Objects with `ok` boolean field returned from API routes

**Pattern from `/Users/devondunn/projects/linearapp/apps/server/src/adapters/linearGraphql.ts`:**
```typescript
private async query<TData>(query: string, variables: Record<string, unknown>): Promise<TData>

async listStatuses(teamKey: string): Promise<LinearStatus[]>
```

## Module Design

**Exports:**
- Named exports for utility functions and types
- Default exports for React components
- Type-only exports use `export type`
- Classes exported as named exports

**Barrel Files:**
- `/Users/devondunn/projects/linearapp/apps/server/src/tools/index.ts` exports tool definitions and handlers

**Layered Architecture:**
- Adapters (external integrations): `/src/adapters/` — e.g., `linearGraphql.ts`, `openaiClient.ts`
- Services (business logic): `/src/services/` — e.g., `syncService.ts`, `enrichmentService.ts`
- Routes (HTTP handlers): `/src/routes/` — e.g., `health.ts`, `board.ts`
- Database: `/src/db.ts` — data persistence
- Config: `/src/config.ts` — environment configuration
- Libraries: `/src/lib/` — utilities like `logger.ts`, `dateUtils.ts`

**Dependency Direction:**
- Routes depend on services and adapters
- Services depend on adapters, db, and config
- Adapters depend on config
- No circular dependencies

**API/Web Integration:**
- `/Users/devondunn/projects/linearapp/apps/web/src/api.ts` — centralized API client with type-safe requests
- All API endpoints prefixed with `/api`
- Comments separate logical endpoint groups (e.g., `// ─── Dashboard ───`)

## React Component Patterns

**Functional Components:**
- Default export: `export default function ComponentName() { return JSX; }`
- Props typed inline or via interface
- useState hooks for local state
- useRouter or useOutlet for navigation

**Styling:**
- MUI (`@mui/material`) used for components and theming
- Inline `sx` prop for styling (e.g., `sx={{ display: "flex", minHeight: "100vh" }}`)
- Theme provider at app root (`/Users/devondunn/projects/linearapp/apps/web/src/theme.ts`)

**Example from `/Users/devondunn/projects/linearapp/apps/web/src/components/StatusChip.tsx`:**
```typescript
const statusColors: Record<string, "success" | "warning" | "error" | "info" | "default"> = {
  done: "success",
  in_progress: "info",
};

export default function StatusChip({ status }: { status: string }) {
  return <Chip label={status.replace(/_/g, " ")} ... />;
}
```

---

*Convention analysis: 2026-02-12*
