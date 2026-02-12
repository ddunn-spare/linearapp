# AI Chat Actions & Approvals

## What This Is

An extension to the existing AI chat assistant in a Linear-powered engineering management app. The chat already answers questions and queries data — this adds the ability to *take actions* (create issues, manage cycles, update OKRs, etc.) with an inline approval flow. The agent proposes an action, shows an approval card in chat, and on approval executes immediately via Linear API, GitHub API, or internal structures.

## Core Value

The AI agent can propose and execute real actions across Linear, GitHub, and internal tools — with user approval before anything changes.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from existing codebase. -->

- ✓ Multi-turn AI chat with conversation history — existing
- ✓ OpenAI function calling with 12+ read-only tools — existing
- ✓ SSE streaming with tool call visualization — existing
- ✓ Linear data sync (issues, cycles, members, statuses) — existing
- ✓ GitHub PR/review sync with branch-to-issue linking — existing
- ✓ OKR management with key results and issue linking — existing
- ✓ Board with drag-and-drop card movement and WIP limits — existing
- ✓ Issue enrichment (RICE scores, assignment suggestions, OKR matching) — existing
- ✓ Cycle progress tracking with burndown and velocity — existing
- ✓ Quick suggestion chips in chat UI — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] Agent can propose write actions with inline approval cards in chat
- [ ] User can approve or decline proposed actions before execution
- [ ] Approved actions execute immediately and show results in chat
- [ ] Linear write actions: create/update/delete issues, change status, assign, add comments
- [ ] Linear workflow actions: create/manage projects, cycles, labels, bulk operations
- [ ] GitHub actions: create PRs, create/update issues, request reviews
- [ ] Internal actions: create/update OKRs and key results
- [ ] Info/capabilities button showing what the agent can do
- [ ] Rich markdown rendering in chat (tables, code blocks, headers, lists)
- [ ] Agent can query and reason across all connected data sources (Linear, GitHub, OKRs)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Multi-step approval chains — single approve/decline is sufficient for v1
- Undo/rollback after execution — actions are final once approved
- Batch approval of multiple actions at once — one at a time keeps it simple
- Custom action definitions by users — agent capabilities are predefined
- Webhooks for real-time Linear/GitHub updates — polling sync is sufficient

## Context

The app is a monorepo (server/web/shared) using TypeScript, Fastify, React 19, MUI, SQLite. The AI chat uses OpenAI function calling with SSE streaming. There are already 12+ read-only tools the agent can invoke. The existing tool handler registry pattern (`apps/server/src/tools/index.ts`) is extensible — new tools follow the same definition + handler pattern.

The Linear adapter (`linearGraphql.ts`) already handles GraphQL queries and has `updateIssueStatus()` for board card movement. GitHub adapter uses Octokit REST. The chat service already handles multi-iteration function calling loops (max 5 iterations).

Key existing patterns to build on:
- Tool definitions with JSON schema → handler functions in `tools/index.ts`
- SSE event types: `delta`, `tool_call_start`, `tool_call_result`, `done`, `error`
- Shared types in `@linearapp/shared` for server/client consistency
- Zod validation for request bodies

## Constraints

- **Tech stack**: Must use existing stack (TypeScript, Fastify, React, MUI, OpenAI, SQLite)
- **API limits**: Linear and GitHub APIs have rate limits — actions should be mindful
- **Auth model**: No user auth currently; app assumes trusted single-user environment
- **LLM provider**: OpenAI for function calling (existing integration)

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Inline approval cards in chat | Keeps flow in context, no panel switching | — Pending |
| Execute immediately on approve | Simple UX, no preview step needed for v1 | — Pending |
| Extend existing tool registry | Builds on proven pattern, minimal refactoring | — Pending |
| Full Linear workflow scope | User wants projects, cycles, labels, not just issues | — Pending |

---
*Last updated: 2026-02-12 after initialization*
