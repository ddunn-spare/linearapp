# Stack Research: AI Action Execution with Approval Flows

**Domain:** Agentic AI chat with human-in-the-loop approval for write actions
**Researched:** 2026-02-12
**Confidence:** HIGH (core patterns) / MEDIUM (specific versions)

## Context: What Already Exists

The existing system provides:
- **OpenAI SDK** (`openai@6.21.0`) with function calling and SSE streaming
- **12 read-only tools** via `getToolDefinitions()` / `createToolHandlers()` in `apps/server/src/tools/index.ts`
- **Linear GraphQL client** (`apps/server/src/adapters/linearGraphql.ts`) -- already has `updateIssueStatus` mutation and raw `query()` method
- **GitHub client** (`apps/server/src/adapters/githubClient.ts`) -- Octokit-based, currently read-only
- **Chat service** (`apps/server/src/services/chatService.ts`) with tool-calling loop (max 5 iterations)
- **SSE streaming** via raw `reply.raw.writeHead` in Fastify
- **No markdown rendering** -- assistant messages render as plain text via `Typography` with `whiteSpace: pre-wrap`

This research covers only what's needed to add approval-gated write actions and rich rendering. It does not re-cover the existing stack.

---

## Recommended Stack

### Markdown Rendering

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| react-markdown | ^10.1.0 | Render AI assistant responses as rich markdown | The standard React markdown renderer. Uses remark/rehype pipeline, renders to React components (no dangerouslySetInnerHTML), supports custom component overrides for MUI integration. ESM-only, works with Vite. React 19 compatible as of v9+. |
| remark-gfm | ^4.0.1 | GitHub Flavored Markdown support | Adds tables, task lists, strikethrough, autolinks. AI responses frequently use tables and task lists -- without this, they render as plain text. |
| rehype-highlight | ^7.0.2 | Syntax highlighting in code blocks | Plugin-based highlighting via highlight.js/lowlight. Runs at render time in the remark/rehype pipeline -- lighter than react-syntax-highlighter (which ships a separate runtime). Bundles 37 languages by default. |
| highlight.js | ^11.11.0 | CSS themes for code highlighting | Required by rehype-highlight for theme stylesheets. Use a dark theme (e.g., `github-dark`) to match the app's existing dark MUI theme. Only need to import the CSS file. |

**Confidence: HIGH** -- react-markdown is the de facto standard for React markdown rendering. v10 confirmed on npm. remark-gfm and rehype-highlight are the canonical plugins in the unified ecosystem.

### Approval Flow Infrastructure (Server)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| openai | ^6.21.0 (already installed) | Function calling with tool_calls | No additional SDK needed. The existing OpenAI function calling pattern naturally supports approval gating. When the model returns a `tool_calls` response with a write action, the server classifies it as requiring approval and pauses instead of executing. |
| zod | ^3.24.2 (already installed) | Action parameter validation | Already used for request validation. Extend to validate tool arguments for write actions before presenting to user. Ensures the approval card shows valid, well-typed parameters. |
| better-sqlite3 | ^11.8.1 (already installed) | Persist pending actions and audit log | Already the persistence layer. Add tables for pending actions (state machine: pending -> approved/rejected/expired) and an audit log of all executed write actions. |
| crypto (Node built-in) | N/A | Action IDs and idempotency keys | Use `crypto.randomUUID()` (already used for message IDs) for action identifiers. No new dependency needed. |

**Confidence: HIGH** -- No new server dependencies required. The approval flow is an architectural pattern on top of existing function calling, not a library choice.

### Approval Flow Infrastructure (Client)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| @mui/material | ^7.3.8 (already installed) | Approval card UI components | Build approval cards from existing MUI components: Card, CardContent, CardActions, Button, Chip, Alert. Consistent with the rest of the app. No new UI library needed. |
| @mui/icons-material | ^7.3.8 (already installed) | Action-specific icons | Icons for approve/reject buttons, action types (e.g., AssignmentInd for assign, Edit for update, Add for create). Already installed. |

**Confidence: HIGH** -- Pure UI pattern using existing components.

### Linear API Mutations (Server)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| LinearGraphqlClient (existing) | N/A | Execute write mutations against Linear | The existing `linearGraphql.ts` adapter already has `updateIssueStatus()` and a private `query()` method that accepts arbitrary GraphQL. Extend with new mutation methods: `createIssue()`, `updateIssue()`, `assignIssue()`, `addComment()`, etc. No @linear/sdk needed -- raw GraphQL is already working and avoids adding a 75.x versioned heavy SDK. |

**Confidence: HIGH** -- Verified the existing client supports mutations. `updateIssueStatus` is already a mutation.

### GitHub API Mutations (Server)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| @octokit/rest | ^22.0.1 (already installed) | Execute write operations against GitHub | The existing Octokit instance is read-only but the library supports all GitHub REST API operations. Extend with methods for: creating PR review comments, requesting reviewers, merging PRs, creating issues. No new dependency. |

**Confidence: HIGH** -- Octokit is already installed and configured with auth.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| vitest (already installed) | Test approval flow state machine | The action state machine (pending/approved/rejected/expired) and tool classification (read vs write) are critical to test. Already have vitest@3.0.7 in server. |
| TypeScript strict mode (already configured) | Type-safe action definitions | Discriminated unions for action types ensure exhaustive handling in switch statements. Already enabled. |

---

## Installation

```bash
# New dependencies (web app only)
npm --workspace @linearapp/web install react-markdown@^10.1.0 remark-gfm@^4.0.1 rehype-highlight@^7.0.2

# For code highlighting themes (peer dependency of rehype-highlight)
npm --workspace @linearapp/web install highlight.js@^11.11.0

# No new server dependencies needed
```

**Total new dependencies: 4** (all in the web workspace, all for markdown rendering). The approval flow itself requires zero new packages.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| react-markdown + remark-gfm | mui-markdown (v2.0.3) | mui-markdown wraps markdown-to-jsx, not the unified/remark ecosystem. Smaller plugin ecosystem. React 19 compatibility unverified. react-markdown's component override system maps directly to MUI -- `components={{ h1: (props) => <Typography variant="h4" {...props} /> }}`. |
| react-markdown + remark-gfm | marked + DOMPurify | Marked outputs raw HTML strings requiring dangerouslySetInnerHTML. XSS risk. Cannot easily embed React components (like approval cards) inline. Not React-native. |
| rehype-highlight | react-syntax-highlighter | react-syntax-highlighter is not actively maintained. It's a separate React component approach rather than a pipeline plugin. Heavier bundle. rehype-highlight integrates naturally with react-markdown's remark/rehype pipeline. |
| Custom approval flow on OpenAI SDK | Vercel AI SDK (ai@6.x) | AI SDK 6 has `needsApproval: true` built in, which is elegant. But adopting it means replacing the entire chat backend (OpenAI client, streaming, tool execution loop). The app already has a working SSE streaming + function calling loop. Adding approval gating is ~50 lines of classification logic vs. a full SDK migration. The juice is not worth the squeeze. |
| Custom approval flow on OpenAI SDK | OpenAI Agents SDK (@openai/agents@0.4.6) | Still in early versions (0.4.x). Adds agent abstraction layer the app doesn't need. The existing function calling loop is simple and correct. Agents SDK is for multi-agent orchestration, not single-agent approval flows. |
| Extending LinearGraphqlClient | @linear/sdk (v75.0.0) | The SDK is at version 75 -- it releases frequently with Linear API schema changes, creating version churn. The existing raw GraphQL client is stable, well-typed, and only needs a few new mutation methods. The SDK would add a large dependency for marginal benefit. |
| Raw Octokit REST calls | graphql-request for GitHub | GitHub's GraphQL API exists but Octokit REST is already configured and covers all needed mutations (merge PR, request reviewer, create comment). No reason to add a second client paradigm. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| LangChain / LangGraph | Massive dependency for a simple approval pattern. The app has 12 tools and one agent. LangChain adds abstraction layers that obscure the straightforward OpenAI function calling flow you already own. | Keep the existing `chatService.ts` tool-calling loop and add approval classification inline. |
| Vercel AI SDK (ai) | Would require replacing the working SSE streaming, OpenAI client wrapper, and tool execution loop. Major migration for a feature that needs ~50 lines of new server logic. | Extend the existing OpenAI SDK integration. |
| WebSocket for approval responses | The app uses SSE (server-sent events) for chat streaming. Adding WebSocket creates a second real-time protocol to maintain. Approval responses are simple POST requests -- the client clicks approve, sends a POST, and gets a response. | REST POST for approval/rejection + existing SSE for streaming the execution result back into chat. |
| redux / zustand for approval state | Approval cards are local to the chat message stream. The existing `useState` pattern in ChatPage.tsx handles streaming state fine. Adding a state management library for a few pending-action states is over-engineering. | React state in the chat component, same as existing streaming state. |
| Markdown-to-JSX libraries (markdown-to-jsx, mdx) | markdown-to-jsx has a smaller plugin ecosystem than unified/remark. MDX is for authoring content with components, not rendering AI output. | react-markdown with remark/rehype plugins. |

---

## Stack Patterns by Variant

**Pattern: Classifying read vs. write tools**
- Tag each tool definition with a `requiresApproval` boolean in the tool metadata (not in the OpenAI function schema -- OpenAI ignores custom fields).
- Maintain a server-side registry: `{ toolName: string, handler: Function, requiresApproval: boolean, riskLevel: 'low' | 'medium' | 'high' }`.
- When the model returns `tool_calls`, check the registry before executing.

**Pattern: Approval-gated tool execution**
- When a tool call requires approval, do NOT execute it.
- Instead: create a pending action record in SQLite, emit an `approval_required` SSE event with the action details, and stop the tool-calling loop.
- The client renders an approval card. User clicks approve/reject.
- On approve: execute the tool, store the result, resume the OpenAI conversation with the tool result.
- On reject: store rejection reason, resume the OpenAI conversation telling the model the action was rejected.

**Pattern: Resuming the OpenAI conversation after approval**
- Store the full message history and pending tool_calls in the pending action record.
- On approval, reconstruct the messages array: `[...history, assistantMessageWithToolCalls, toolResultMessage]` and call OpenAI again.
- The model sees the tool result and generates its final response.

**Pattern: Rendering markdown with inline approval cards**
- Use react-markdown for assistant message text.
- Approval cards are NOT embedded in markdown -- they are separate React components rendered when a `ChatStreamEvent` of type `approval_required` is received.
- The chat message list interleaves: `AssistantMessage` (markdown) -> `ApprovalCard` (MUI component) -> `AssistantMessage` (post-approval markdown).

**Pattern: MUI component mapping for react-markdown**
```typescript
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Typography, Link, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';

const components = {
  h1: (props) => <Typography variant="h5" gutterBottom {...props} />,
  h2: (props) => <Typography variant="h6" gutterBottom {...props} />,
  p: (props) => <Typography variant="body2" sx={{ lineHeight: 1.7, mb: 1.5 }} {...props} />,
  a: (props) => <Link {...props} target="_blank" rel="noopener" />,
  table: (props) => <Table size="small" {...props} />,
  thead: (props) => <TableHead {...props} />,
  tbody: (props) => <TableBody {...props} />,
  tr: (props) => <TableRow {...props} />,
  td: (props) => <TableCell {...props} />,
  th: (props) => <TableCell sx={{ fontWeight: 600 }} {...props} />,
  code: ({ inline, className, children, ...props }) => {
    if (inline) return <code style={{ background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 4 }} {...props}>{children}</code>;
    return <code className={className} {...props}>{children}</code>;
  },
};

// Usage in AssistantMessage component:
<Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
  {content}
</Markdown>
```

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| react-markdown@^10.1.0 | React ^19.0.0 | ESM only. v9+ dropped defaultProps (React 19 compatible). Works with Vite's ESM-first bundling. |
| remark-gfm@^4.0.1 | react-markdown@^10 | Part of unified ecosystem v11. Must use v4 with react-markdown v10. |
| rehype-highlight@^7.0.2 | react-markdown@^10 | Uses lowlight (highlight.js AST). Compatible with unified v11 / rehype v13. |
| highlight.js@^11.11.0 | rehype-highlight@^7 | Only needed for CSS theme imports. rehype-highlight bundles lowlight which uses highlight.js internally. |
| openai@^6.21.0 | Node 22.13+ | Already installed. Supports streaming, function calling, tool_choice. |
| @mui/material@^7.3.8 | React ^19.0.0 | MUI v7 has full React 19 support (MUI added React 19 support in v5.18.0+). |

---

## Key Architecture Decision: Why NOT Use an Agent Framework

The existing system has a simple, correct tool-calling loop:

```
User message -> OpenAI API -> tool_calls? -> execute tools -> feed results back -> repeat (max 5x)
```

Adding approval gating means:

```
User message -> OpenAI API -> tool_calls? -> classify (read/write) ->
  If read: execute immediately (existing flow)
  If write: pause, emit approval_required, wait for user response ->
    If approved: execute, feed result back to OpenAI, continue
    If rejected: feed rejection back to OpenAI, continue
```

This is a ~50-line addition to `chatService.ts`, not a framework migration. The app owns its tool-calling loop, which means adding approval classification is trivial. Adopting LangGraph, Vercel AI SDK, or OpenAI Agents SDK would require replacing this loop with framework-managed orchestration -- adding complexity and losing control, all for a feature that's a simple state machine.

---

## Sources

- [react-markdown GitHub](https://github.com/remarkjs/react-markdown) -- v10.1.0 confirmed, ESM only, React 19 compatible via v9+ (HIGH confidence)
- [react-markdown npm](https://www.npmjs.com/package/react-markdown) -- v10.1.0, 4750+ dependents (HIGH confidence)
- [remark-gfm npm](https://www.npmjs.com/package/remark-gfm) -- v4.0.1, 3347+ dependents (HIGH confidence)
- [rehype-highlight npm](https://www.npmjs.com/package/rehype-highlight) -- v7.0.2 (HIGH confidence)
- [react-markdown React 19 issue #828](https://github.com/remarkjs/react-markdown/issues/828) -- v9+ resolves defaultProps deprecation (HIGH confidence)
- [OpenAI function calling docs](https://platform.openai.com/docs/guides/function-calling) -- tool_calls flow, tool_choice options (HIGH confidence)
- [OpenAI Agents SDK HITL](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/) -- needsApproval pattern reference (MEDIUM confidence, evaluated but not recommended)
- [Vercel AI SDK HITL cookbook](https://ai-sdk.dev/cookbook/next/human-in-the-loop) -- needsApproval: true pattern reference (MEDIUM confidence, evaluated but not recommended)
- [Linear GraphQL API](https://linear.app/developers/graphql) -- issueCreate, issueUpdate, issueAssign mutations (HIGH confidence)
- [@linear/sdk npm](https://www.npmjs.com/package/@linear/sdk) -- v75.0.0, evaluated but not recommended due to version churn (MEDIUM confidence)
- [Existing codebase: linearGraphql.ts] -- Confirmed updateIssueStatus mutation already works (HIGH confidence)
- [Existing codebase: githubClient.ts] -- Octokit already configured with auth (HIGH confidence)
- [Existing codebase: chatService.ts] -- Tool-calling loop confirmed, 5 iteration max (HIGH confidence)

---
*Stack research for: AI action execution with approval flows*
*Researched: 2026-02-12*
