# Testing Patterns

**Analysis Date:** 2026-02-12

## Test Framework

**Runner:**
- Vitest 3.0.7 (configured in server workspace)
- Command: `npm run test` (runs `vitest run` in `/Users/devondunn/projects/linearapp/apps/server/package.json`)
- Watch mode: Not explicitly configured, but supported by vitest
- No config file found — uses Vitest defaults

**Assertion Library:**
- Vitest built-in `expect()` API (no separate assertion library)

**Run Commands:**
```bash
npm --workspace @linearapp/server run test  # Run all tests in server
npm run test --workspaces                   # Run tests across all workspaces
```

**Note:** Web app has no tests (`@linearapp/web` test script is `echo "No tests for web"`)

## Test File Organization

**Location:**
- Tests NOT co-located with source — compiled test files live in `/Users/devondunn/projects/linearapp/apps/server/dist/tests/`
- Original TypeScript test files location unknown (likely `/src/tests/` but not visible in file exploration)
- Test files compiled to JavaScript before running

**Naming:**
- Test files use `.test.ts` suffix (e.g., `db.test.ts`, `linearService.test.ts`)
- Compiled to `.test.js` in dist folder

**Current Tests:**
- `db.test.js` — StateDb sync status tests
- `linearService.test.js` — LinearService initialization tests
- `enrichmentService.test.js` — EnrichmentService enrichment tests
- `okrService.test.js` — OkrService indexing tests
- `appConnectivity.test.js` — App connectivity tests

## Test Structure

**Suite Organization (from compiled tests):**

```typescript
describe("StateDb sync status", () => {
  it("clears stale errors after a successful sync job", () => {
    // test body
  });
});

describe("LinearService", () => {
  it("initializes in none mode without API key", async () => {
    // test body
  });
});
```

**Patterns:**

1. **Setup/Teardown Pattern:**
   - `afterEach()` for cleanup (temp file removal)
   - Example from `enrichmentService.test.js`:
   ```typescript
   const tempPaths = [];
   const mkTemp = () => {
     const root = fs.mkdtempSync(path.join(os.tmpdir(), "linear-pm-enrich-"));
     tempPaths.push(root);
     return { dirs };
   };
   afterEach(() => {
     for (const temp of tempPaths.splice(0)) {
       fs.rmSync(temp, { recursive: true, force: true });
     }
   });
   ```

2. **Fixture/Factory Pattern:**
   - Test data factories for creating objects
   - Example from `enrichmentService.test.js`:
   ```typescript
   const createIssue = (overrides) => ({
     issueId: overrides.issueId || "issue-a",
     identifier: overrides.identifier || "EAM-1",
     title: overrides.title || "Default issue",
     // ... more defaults
   });
   ```

3. **Test Isolation:**
   - Temporary directories created per test
   - Cleanup runs after each test
   - No shared state between tests

## Mocking

**Framework:** Vitest mocking API (built-in, no separate library like Jest)

**Patterns:**
- Failing external services by not providing config (e.g., passing `undefined` for API keys)
- Fallback implementations for unavailable providers
- Example from `enrichmentService.test.js`:
  ```typescript
  const ai = new AiService({
    // ... config
    linearApiKey: undefined,  // Simulates no API key
    claudeCliCommand: "false", // Command that fails
  });
  ```

**What to Mock:**
- External API clients (Linear API, OpenAI, GitHub)
- File system operations (via temp directories)
- Environment-dependent services

**What NOT to Mock:**
- Database layer (`StateDb`) — uses temporary in-memory SQLite databases
- Service business logic — test actual implementations
- Data factories — use real constructors

## Fixtures and Factories

**Test Data:**
- Factory functions create test objects with defaults and overrides
- Pattern from `enrichmentService.test.js`:
  ```typescript
  const createIssue = (overrides) => ({
    issueId: overrides.issueId || "issue-a",
    identifier: overrides.identifier || "EAM-1",
    title: overrides.title || "Default issue",
    description: overrides.description || "Description",
    // ... spreads overrides to allow customization
  });
  ```

**Location:**
- Inline within test files (no shared fixtures directory)
- Factories scoped to test suites that use them

**Temporary Directories:**
- Created with `fs.mkdtempSync()` in test setup
- Paths tracked in array for cleanup
- Cleanup via `fs.rmSync()` in `afterEach()`

## Coverage

**Requirements:** Not detected in configuration

**View Coverage:**
- No coverage tools configured
- Use: `vitest run --coverage` (if Istanbul/v8 provider installed)

## Test Types

**Unit Tests:**
- Scope: Individual services and classes
- Approach: Create instance with config, call methods, assert results
- Example from `db.test.js`:
  ```typescript
  const db = new StateDb(mkTempDb());
  db.markJobStart("initial-failure");
  db.markJobEnd("initial-failure", { success: false, error: "..." });
  expect(db.getSyncStatus().errors).toEqual(["Linear adapter not configured"]);
  ```

**Integration Tests:**
- Scope: Service interactions (e.g., EnrichmentService using Db and AiService)
- Approach: Create multiple services with shared mocked config, test end-to-end flow
- Example from `enrichmentService.test.js`:
  ```typescript
  const db = new StateDb(dirs.dbPath);
  const ai = new AiService({ ... }, db);
  const enrichmentService = new EnrichmentService({ ... }, db, ai);
  const results = await enrichmentService.enrichAll({ ... });
  expect(results).toHaveLength(1);
  ```

**E2E Tests:**
- Not detected — no Playwright/Cypress setup
- Web app has no tests

## Common Patterns

**Async Testing:**
- Test functions marked `async`
- `await` used for Promise-returning methods
- `expect().resolves` pattern for async assertions
- Example from `linearService.test.js`:
  ```typescript
  await expect(linear.initialize()).resolves.toBeUndefined();
  ```

**Error Testing:**
- Services initialized without critical config to trigger fallback/error paths
- Assertions check error states and recovery
- Example from `db.test.js`:
  ```typescript
  db.markJobEnd("initial-failure", {
    success: false,
    mode: "none",
    error: "Linear adapter not configured"
  });
  expect(db.getSyncStatus().errors).toEqual(["Linear adapter not configured"]);
  ```

**Assertion Patterns:**
- `expect(value).toBe(expected)` — strict equality
- `expect(value).toEqual(expected)` — deep equality
- `expect(value).toHaveLength(n)` — array/string length
- `expect(value).toBeGreaterThan(n)` — numeric comparison
- `expect(value).toBeDefined()` — existence check
- `expect(value).resolves.toBeUndefined()` — async Promise assertion

## Test Data Setup

**StateDb Pattern:**
```typescript
const mkTempDb = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linear-pm-db-"));
  tempPaths.push(root);
  return path.join(root, "state.db");
};

// Usage in test
const db = new StateDb(mkTempDb());
// Insert test data
db.upsertSnapshots([createIssue({ ... })]);
```

**File Fixtures:**
```typescript
const mkTemp = () => {
  const root = fs.mkdtempSync(...);
  fs.mkdirSync(dirs.okrDir, { recursive: true });
  fs.writeFileSync(path.join(dirs.okrDir, "valid.md"), `---\n...\n`, "utf-8");
  return { dirs };
};
```

## Running Tests Locally

**Prerequisites:**
- TypeScript compiled to JavaScript in `/dist/tests/`
- Test files must exist in dist before running

**Command:**
```bash
cd /Users/devondunn/projects/linearapp
npm --workspace @linearapp/server run test
```

**Output:**
- Vitest reports test results for all `.test.js` files in dist/tests/

---

*Testing analysis: 2026-02-12*
