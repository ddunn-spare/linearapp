# Technology Stack

**Analysis Date:** 2026-02-12

## Languages

**Primary:**
- TypeScript 5.7.3 - Entire codebase (strict mode enabled)

**Secondary:**
- JavaScript - Configuration files and build tools
- Markdown - OKR documentation and context storage

## Runtime

**Environment:**
- Node.js 22.13+ (via package.json `@types/node: ^22.13.0`)

**Module Types:**
- Server: CommonJS (`apps/server/package.json` type: "commonjs")
- Web: ESM (`apps/web/package.json` type: "module")
- Shared: ESM (`packages/shared/package.json` type: "module")

**Package Manager:**
- npm (workspace monorepo with npm-run-all)
- Lockfile: package-lock.json present

## Frameworks

**Backend:**
- Fastify 5.2.1 - HTTP server with CORS and logging
- better-sqlite3 11.8.1 - Embedded SQL database (state persistence)

**Frontend:**
- React 19.0.0 - UI framework
- Vite 6.1.0 - Build tool and dev server (port 7923)
- React Router 7.13.0 - Client-side routing

**UI Component Libraries:**
- Material-UI (@mui/material 7.3.8, @mui/icons-material 7.3.8)
- Emotion (@emotion/react 11.14.0, @emotion/styled 11.14.1) - CSS-in-JS

**UI Enhancement:**
- @dnd-kit/core 6.3.1, @dnd-kit/sortable 10.0.0, @dnd-kit/utilities 3.2.2 - Drag and drop
- recharts 3.7.0 - Charts and data visualization

**Validation & Parsing:**
- zod 3.24.2 - TypeScript-first schema validation and request parsing

**Server Utilities:**
- dotenv 16.4.7 - Environment variable loading
- gray-matter 4.0.3 - YAML frontmatter parsing (for OKR markdown documents)
- @fastify/cors 10.0.2 - CORS middleware

**Testing:**
- vitest 3.0.7 - Unit/integration test runner (server only)

**Build & Development:**
- TypeScript 5.7.3 - Compilation
- tsx 4.19.2 - TypeScript execution without compilation
- @vitejs/plugin-react 4.3.4 - React JSX support in Vite

## Key Dependencies

**Critical:**
- @octokit/rest 22.0.1 - GitHub REST API client for PR data retrieval
- openai 6.21.0 - OpenAI Chat API client for AI enrichment and chat features
- @linearapp/shared * - Internal shared types package (monorepo)

**Infrastructure:**
- better-sqlite3 11.8.1 - Persistence layer for state, issues, OKRs, PRs, chat history
- fastify 5.2.1 - HTTP request handling and routing
- zod 3.24.2 - Runtime validation for API requests

## Configuration

**Environment Variables:**
- `.env` file (located at project root, found via upward traversal)
- `LINEAR_API_KEY` - Linear GraphQL API authentication
- `OPENAI_API_KEY` - OpenAI API authentication
- `GITHUB_TOKEN` - GitHub REST API authentication
- `LINEAR_TEAM_KEY` - Team identifier (default: "EAM")
- `APP_PORT` - Server port (default: 7917)
- `CORS_ORIGIN` - Frontend origin (default: http://localhost:7923)
- `VITE_WEB_PORT` - Frontend dev server port (default: 7923)
- `VITE_API_BASE_URL` - Frontend API target (default: http://localhost:7917)
- `LINEAR_API_URL` - Linear API endpoint (default: https://api.linear.app/graphql)
- `GITHUB_ORG` - GitHub organization for PR sync
- `GITHUB_REPOS` - Comma-separated list of repos to sync
- `LOG_LEVEL` - Fastify logger level (default: "info")
- `EXPOSE_ERROR_DETAILS` - Include stack traces in 500 responses (default: true in dev)

**TypeScript Configuration:**
- `tsconfig.base.json` - Shared base config (ES2022 target, strict mode, NodeNext resolution)
- `apps/server/tsconfig.json` - CommonJS, Node resolution, outDir: dist/
- `apps/web/tsconfig.json` - ESNext, Bundler resolution, jsx: react-jsx
- `packages/shared/tsconfig.json` - ESM module export config

**Build Configuration:**
- `apps/web/vite.config.ts` - React plugin, dev server on port 7923, proxy /api to backend
- `package.json` workspaces - Root manages @linearapp/server, @linearapp/web, @linearapp/shared

## Platform Requirements

**Development:**
- Node.js 22.13+
- npm (or compatible)
- Git (for cloning)
- Text editor/IDE supporting TypeScript

**Production:**
- Node.js 22.13+ runtime
- SQLite 3 (bundled with better-sqlite3)
- Outbound HTTPS access to:
  - Linear GraphQL API (api.linear.app)
  - OpenAI API (api.openai.com)
  - GitHub REST API (api.github.com)

**Storage:**
- Local filesystem for SQLite database (`~/.linear-pm-agent/state.db` or configured via `LINEAR_PM_STATE_ROOT`)
- Markdown files for OKR context (`~/.linear-pm-agent/context/okrs/`)
- Issue context files (`~/.linear-pm-agent/context/issues/`)
- Job logs (`~/.linear-pm-agent/logs/jobs/`)

---

*Stack analysis: 2026-02-12*
