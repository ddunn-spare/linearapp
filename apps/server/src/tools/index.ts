import type { StateDb } from "../db";
import type { LinearGraphqlClient } from "../adapters/linearGraphql";
import type { AppConfig } from "../config";
import type OpenAI from "openai";
import type { ActionPreviewField, ActionCategory } from "@linearapp/shared";

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

type ToolMetadata = {
  requiresApproval: boolean;
  category: "query" | "action";
  descriptionForUser: string;
  destructive?: boolean;
  actionCategory?: ActionCategory;
  generatePreview?: (args: Record<string, unknown>) => ActionPreviewField[];
};

const toolMetadata = new Map<string, ToolMetadata>([
  ["search_issues", { requiresApproval: false, category: "query", descriptionForUser: "Search issues by keyword" }],
  ["get_issue_detail", { requiresApproval: false, category: "query", descriptionForUser: "Get details of a specific issue" }],
  ["get_team_workload", { requiresApproval: false, category: "query", descriptionForUser: "Get current workload for all team members" }],
  ["get_cycle_stats", { requiresApproval: false, category: "query", descriptionForUser: "Get current cycle statistics" }],
  ["get_okrs", { requiresApproval: false, category: "query", descriptionForUser: "Get all OKRs with progress" }],
  ["get_github_prs", { requiresApproval: false, category: "query", descriptionForUser: "Get pull requests" }],
  ["find_similar_issues", { requiresApproval: false, category: "query", descriptionForUser: "Find issues similar to a query" }],
  ["calculate_rice", { requiresApproval: false, category: "query", descriptionForUser: "Calculate RICE score" }],
  ["evaluate_okr_fit", { requiresApproval: false, category: "query", descriptionForUser: "Evaluate OKR alignment for an issue" }],
  ["recommend_assignee", { requiresApproval: false, category: "query", descriptionForUser: "Recommend the best assignee for an issue" }],
  ["get_dashboard_summary", { requiresApproval: false, category: "query", descriptionForUser: "Get team dashboard summary" }],
  ["query_data", { requiresApproval: false, category: "query", descriptionForUser: "Run a read-only SQL query" }],
  ["create_issue", {
    requiresApproval: true,
    category: "action",
    actionCategory: "linear",
    descriptionForUser: "Create a new issue in Linear",
    generatePreview: (args: Record<string, unknown>) => {
      const fields: ActionPreviewField[] = [];
      fields.push({ field: "Title", newValue: String(args.title || "") });
      if (args.description) fields.push({ field: "Description", newValue: String(args.description).slice(0, 100) + (String(args.description).length > 100 ? "..." : "") });
      if (args.priority !== undefined && args.priority !== null) {
        const labels = ["None", "Urgent", "High", "Medium", "Low"];
        fields.push({ field: "Priority", newValue: labels[Number(args.priority)] || "None" });
      }
      if (args.assigneeName) fields.push({ field: "Assignee", newValue: String(args.assigneeName) });
      if (args.labelNames && Array.isArray(args.labelNames) && args.labelNames.length > 0) {
        fields.push({ field: "Labels", newValue: args.labelNames.join(", ") });
      }
      if (args.projectName) fields.push({ field: "Project", newValue: String(args.projectName) });
      return fields;
    },
  }],
  ["update_issue", {
    requiresApproval: true,
    category: "action",
    actionCategory: "linear",
    descriptionForUser: "Update an existing Linear issue",
    generatePreview: (args: Record<string, unknown>) => {
      const fields: ActionPreviewField[] = [];
      fields.push({ field: "Issue", newValue: String(args.issueId || "") });
      if (args.title !== undefined && args.title !== null) fields.push({ field: "Title", oldValue: "(current)", newValue: String(args.title) });
      if (args.description !== undefined && args.description !== null) fields.push({ field: "Description", oldValue: "(current)", newValue: String(args.description).slice(0, 100) + (String(args.description).length > 100 ? "..." : "") });
      if (args.priority !== undefined && args.priority !== null) {
        const labels = ["None", "Urgent", "High", "Medium", "Low"];
        fields.push({ field: "Priority", oldValue: "(current)", newValue: labels[Number(args.priority)] || "None" });
      }
      if (args.assigneeName !== undefined && args.assigneeName !== null) fields.push({ field: "Assignee", oldValue: "(current)", newValue: String(args.assigneeName) });
      if (args.status !== undefined && args.status !== null) fields.push({ field: "Status", oldValue: "(current)", newValue: String(args.status) });
      if (args.labelNames && Array.isArray(args.labelNames) && args.labelNames.length > 0) {
        fields.push({ field: "Labels", oldValue: "(current)", newValue: args.labelNames.join(", ") });
      }
      if (args.projectName !== undefined && args.projectName !== null) fields.push({ field: "Project", oldValue: "(current)", newValue: String(args.projectName) });
      return fields;
    },
  }],
  ["delete_issue", {
    requiresApproval: true,
    category: "action",
    actionCategory: "linear",
    destructive: true,
    descriptionForUser: "Delete a Linear issue permanently",
    generatePreview: (args: Record<string, unknown>) => {
      return [{ field: "Issue", newValue: String(args.issueId || "") }];
    },
  }],
  ["add_comment", {
    requiresApproval: true,
    category: "action",
    actionCategory: "linear",
    descriptionForUser: "Add a comment to a Linear issue",
    generatePreview: (args: Record<string, unknown>) => {
      return [
        { field: "Issue", newValue: String(args.issueId || "") },
        { field: "Comment", newValue: String(args.body || "") },
      ];
    },
  }],
]);

export function getToolMetadata(toolName: string): ToolMetadata | undefined {
  return toolMetadata.get(toolName);
}

export function isWriteTool(toolName: string): boolean {
  const meta = toolMetadata.get(toolName);
  return meta?.requiresApproval === true;
}

export function getWriteToolSummaries(): { name: string; description: string }[] {
  const results: { name: string; description: string }[] = [];
  for (const [name, meta] of toolMetadata) {
    if (meta.requiresApproval) {
      results.push({ name, description: meta.descriptionForUser });
    }
  }
  return results;
}

export function getToolActionCategory(toolName: string): ActionCategory | undefined {
  return toolMetadata.get(toolName)?.actionCategory;
}

export function isDestructiveTool(toolName: string): boolean {
  return toolMetadata.get(toolName)?.destructive === true;
}

export function generatePreviewForTool(toolName: string, args: Record<string, unknown>): ActionPreviewField[] {
  const meta = toolMetadata.get(toolName);
  if (meta?.generatePreview) {
    return meta.generatePreview(args);
  }
  // Generic preview: list all arguments as fields
  const fields: ActionPreviewField[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && value !== null) {
      fields.push({ field: key, newValue: String(value) });
    }
  }
  return fields;
}

export function getToolDefinitions(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return [
    {
      type: "function",
      function: {
        name: "search_issues",
        description: "Search for issues by keyword in title, identifier, or description",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: ["number", "null"], description: "Max results (default 10)" },
          },
          required: ["query", "limit"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_issue_detail",
        description: "Get full details of a specific issue by ID or identifier",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            issueId: { type: "string", description: "Issue ID or identifier" },
          },
          required: ["issueId"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_team_workload",
        description: "Get current workload for all team members including WIP counts and active issues",
        strict: true,
        parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_cycle_stats",
        description: "Get current cycle statistics including progress, burndown, and member breakdown",
        strict: true,
        parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_okrs",
        description: "Get all OKRs with progress and key results",
        strict: true,
        parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "get_github_prs",
        description: "Get pull requests, optionally filtered by author or state",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            authorLogin: { type: ["string", "null"], description: "Filter by author GitHub username" },
            state: { type: ["string", "null"], enum: ["open", "closed", "merged", null], description: "Filter by PR state" },
          },
          required: ["authorLogin", "state"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "find_similar_issues",
        description: "Find issues similar to a given query or issue",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search text to find similar issues" },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "calculate_rice",
        description: "Calculate RICE score for given parameters",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            reach: { type: "number", description: "Reach score (0-10)" },
            impact: { type: "number", description: "Impact score (0-3)" },
            confidence: { type: "number", description: "Confidence (0-1)" },
            effort: { type: "number", description: "Effort in person-weeks (0.5-10)" },
          },
          required: ["reach", "impact", "confidence", "effort"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "evaluate_okr_fit",
        description: "Evaluate how well an issue fits with existing OKRs",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            issueId: { type: "string", description: "Issue ID to evaluate" },
          },
          required: ["issueId"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "recommend_assignee",
        description: "Recommend the best assignee for an issue based on workload and expertise",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            issueId: { type: "string", description: "Issue ID to find assignee for" },
          },
          required: ["issueId"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_dashboard_summary",
        description: "Get a summary of the team dashboard including stats and member statuses",
        strict: true,
        parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "query_data",
        description: "Execute a read-only SQL SELECT query against the local database for ad-hoc data retrieval",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            sql: { type: "string", description: "SQL SELECT query to execute" },
          },
          required: ["sql"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_issue",
        description: "Create a new issue in Linear with title, description, priority, assignee, labels, and project",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Issue title" },
            description: { type: ["string", "null"], description: "Issue description (supports markdown)" },
            priority: { type: ["number", "null"], description: "Priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)", enum: [0, 1, 2, 3, 4, null] },
            assigneeName: { type: ["string", "null"], description: "Name of the person to assign (resolved to ID)" },
            labelNames: { type: ["array", "null"], items: { type: "string" }, description: "Label names to apply" },
            projectName: { type: ["string", "null"], description: "Project name to assign to" },
          },
          required: ["title", "description", "priority", "assigneeName", "labelNames", "projectName"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_issue",
        description: "Update one or more fields on an existing Linear issue (status, priority, assignee, labels, etc.)",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            issueId: { type: "string", description: "Issue ID or identifier (e.g. ENG-123)" },
            title: { type: ["string", "null"], description: "New title" },
            description: { type: ["string", "null"], description: "New description" },
            priority: { type: ["number", "null"], description: "New priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)", enum: [0, 1, 2, 3, 4, null] },
            assigneeName: { type: ["string", "null"], description: "New assignee name" },
            status: { type: ["string", "null"], description: "New status name (e.g. In Progress, Done)" },
            labelNames: { type: ["array", "null"], items: { type: "string" }, description: "New label names (replaces existing)" },
            projectName: { type: ["string", "null"], description: "New project name" },
          },
          required: ["issueId", "title", "description", "priority", "assigneeName", "status", "labelNames", "projectName"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_issue",
        description: "Permanently delete a Linear issue. This action cannot be undone.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            issueId: { type: "string", description: "Issue ID or identifier (e.g. ENG-123)" },
          },
          required: ["issueId"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "add_comment",
        description: "Add a comment to a Linear issue (supports markdown formatting)",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            issueId: { type: "string", description: "Issue ID or identifier (e.g. ENG-123)" },
            body: { type: "string", description: "Comment body (supports markdown)" },
          },
          required: ["issueId", "body"],
          additionalProperties: false,
        },
      },
    },
  ];
}

export function createToolHandlers(db: StateDb, linear: LinearGraphqlClient, cfg: AppConfig, trackedLinearIds?: Set<string>): Record<string, ToolHandler> {
  const filterMembers = (members: ReturnType<StateDb["getMembers"]>) =>
    trackedLinearIds && trackedLinearIds.size > 0
      ? members.filter(m => m.linearUserId && trackedLinearIds.has(m.linearUserId))
      : members;

  /**
   * Resolve an issue identifier (e.g. "ENG-123") to a UUID.
   * If the input does not contain "-", assumes it's already a UUID.
   */
  const resolveIssueId = (input: string): string => {
    if (!input.includes("-")) return input;
    const results = db.searchIssues(input, 1);
    const first = results[0];
    if (first && first.snapshot.identifier.toLowerCase() === input.toLowerCase()) {
      return first.snapshot.issueId;
    }
    if (first) return first.snapshot.issueId;
    return input; // Fall through -- Linear API may still resolve it
  };

  /**
   * Resolve a member name to a Linear user ID (case-insensitive partial match).
   */
  const resolveMemberByName = (name: string): string | undefined => {
    const members = db.getMembers();
    const lower = name.toLowerCase();
    const exact = members.find(m => m.name.toLowerCase() === lower);
    if (exact) return exact.linearUserId;
    const partial = members.find(m => m.name.toLowerCase().includes(lower));
    return partial?.linearUserId;
  };

  /**
   * Resolve a project name to a project ID.
   */
  const resolveProjectByName = async (name: string): Promise<string | undefined> => {
    const projects = await linear.listProjects(cfg.linearTeamKey);
    const lower = name.toLowerCase();
    const match = projects.find(p => p.name.toLowerCase() === lower)
      || projects.find(p => p.name.toLowerCase().includes(lower));
    return match?.id;
  };

  /**
   * Resolve a status name to a state ID.
   */
  const resolveStatusByName = async (name: string): Promise<string | undefined> => {
    const statuses = await linear.listStatuses(cfg.linearTeamKey);
    const lower = name.toLowerCase();
    const match = statuses.find(s => s.name.toLowerCase() === lower)
      || statuses.find(s => s.name.toLowerCase().includes(lower));
    return match?.id;
  };

  return {
    search_issues: async (args) => {
      const query = String(args.query || "");
      const limit = Number(args.limit) || 10;
      const results = db.searchIssues(query, limit);
      return JSON.stringify(results.map(i => ({
        issueId: i.snapshot.issueId,
        identifier: i.snapshot.identifier,
        title: i.snapshot.title,
        status: i.snapshot.status,
        boardColumn: i.snapshot.boardColumn,
        assigneeName: i.snapshot.assigneeName,
        priority: i.snapshot.priority,
        rice: i.enrichment?.rice,
      })));
    },

    get_issue_detail: async (args) => {
      const issueId = String(args.issueId);
      // Try by ID first, then search by identifier
      let issue = db.getIssueById(issueId);
      if (!issue) {
        const search = db.searchIssues(issueId, 1);
        issue = search[0];
      }
      if (!issue) return JSON.stringify({ error: "Issue not found" });
      return JSON.stringify({
        ...issue.snapshot,
        enrichment: issue.enrichment,
        pullRequests: issue.pullRequests,
        hasPendingChanges: issue.hasPendingChanges,
      });
    },

    get_team_workload: async () => {
      const members = filterMembers(db.getMembers());
      const wipCounts = db.getWipCountByAssignee();
      const result = members.map(m => {
        const assigneeId = m.linearUserId || m.id;
        const issues = db.getIssuesByAssignee(assigneeId);
        const active = issues.filter(i => i.snapshot.boardColumn === "in_progress" || i.snapshot.boardColumn === "in_review");
        return {
          name: m.name,
          wipCount: wipCounts.get(assigneeId) || 0,
          activeIssues: active.map(i => ({ identifier: i.snapshot.identifier, title: i.snapshot.title, column: i.snapshot.boardColumn })),
          totalAssigned: issues.length,
        };
      });
      return JSON.stringify(result);
    },

    get_cycle_stats: async () => {
      const cycle = db.getActiveCycle();
      if (!cycle) return JSON.stringify({ error: "No active cycle" });
      const issues = db.getIssuesByCycle(cycle.id);
      const completed = issues.filter(i => i.snapshot.boardColumn === "done").length;
      const inProgress = issues.filter(i => i.snapshot.boardColumn === "in_progress" || i.snapshot.boardColumn === "in_review").length;
      return JSON.stringify({
        name: cycle.name,
        progress: Math.round(cycle.progress * 100),
        totalIssues: issues.length,
        completed,
        inProgress,
        remaining: issues.length - completed,
        startsAt: cycle.startsAt,
        endsAt: cycle.endsAt,
      });
    },

    get_okrs: async () => {
      const okrs = db.getOkrs();
      return JSON.stringify(okrs.map(o => ({
        okrId: o.okrId,
        objective: o.objective,
        quarter: o.quarter,
        owner: o.owner,
        progress: Math.round(o.progress),
        keyResults: o.keyResults.map(kr => ({
          description: kr.description,
          progress: Math.round(kr.progress),
          current: kr.currentValue,
          target: kr.targetValue,
          unit: kr.unit,
        })),
        issueCount: o.issueCount,
      })));
    },

    get_github_prs: async (args) => {
      const prs = db.getAllPrs({
        authorLogin: args.authorLogin ? String(args.authorLogin) : undefined,
        state: args.state ? String(args.state) : undefined,
      });
      return JSON.stringify(prs.slice(0, 20).map(pr => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.authorLogin,
        repo: pr.repo,
        reviewStatus: pr.reviewStatus,
        linkedIssue: pr.linkedIssueIdentifier,
        additions: pr.additions,
        deletions: pr.deletions,
        url: pr.url,
      })));
    },

    find_similar_issues: async (args) => {
      const query = String(args.query || "");
      const results = db.searchIssues(query, 5);
      return JSON.stringify(results.map(i => ({
        identifier: i.snapshot.identifier,
        title: i.snapshot.title,
        status: i.snapshot.status,
        assigneeName: i.snapshot.assigneeName,
      })));
    },

    calculate_rice: async (args) => {
      const reach = Number(args.reach) || 0;
      const impact = Number(args.impact) || 0;
      const confidence = Number(args.confidence) || 0;
      const effort = Number(args.effort) || 1;
      const score = (reach * impact * confidence) / effort;
      return JSON.stringify({ reach, impact, confidence, effort, score: Math.round(score * 100) / 100 });
    },

    evaluate_okr_fit: async (args) => {
      const issueId = String(args.issueId);
      const issue = db.getIssueById(issueId);
      if (!issue) return JSON.stringify({ error: "Issue not found" });
      const okrs = db.getOkrs();
      return JSON.stringify({
        issue: { identifier: issue.snapshot.identifier, title: issue.snapshot.title },
        currentOkrMapping: issue.enrichment?.okrId,
        availableOkrs: okrs.map(o => ({ okrId: o.okrId, objective: o.objective, progress: o.progress })),
      });
    },

    recommend_assignee: async (args) => {
      const issueId = String(args.issueId);
      const issue = db.getIssueById(issueId);
      if (!issue) return JSON.stringify({ error: "Issue not found" });
      const members = filterMembers(db.getMembers());
      const wipCounts = db.getWipCountByAssignee();
      const recommendations = members
        .map(m => ({
          name: m.name,
          userId: m.linearUserId || m.id,
          wipCount: wipCounts.get(m.linearUserId || m.id) || 0,
        }))
        .sort((a, b) => a.wipCount - b.wipCount);
      return JSON.stringify({
        issue: { identifier: issue.snapshot.identifier, title: issue.snapshot.title },
        recommendations,
      });
    },

    get_dashboard_summary: async () => {
      const members = filterMembers(db.getMembers());
      const wipCounts = db.getWipCountByAssignee();
      const columnCounts = db.getColumnCounts();
      const cycle = db.getActiveCycle();
      const okrs = db.getOkrs();
      return JSON.stringify({
        inFlight: columnCounts.in_progress + columnCounts.in_review,
        backlog: columnCounts.backlog + columnCounts.todo,
        done: columnCounts.done,
        activeCycle: cycle ? { name: cycle.name, progress: Math.round(cycle.progress * 100) } : null,
        okrCount: okrs.length,
        avgOkrProgress: okrs.length > 0 ? Math.round(okrs.reduce((s, o) => s + o.progress, 0) / okrs.length) : 0,
        teamSize: members.length,
        overloadedMembers: members.filter(m => (wipCounts.get(m.linearUserId || m.id) || 0) >= 5).map(m => m.name),
      });
    },

    query_data: async (args) => {
      const sql = String(args.sql || "").trim();
      if (!sql.toLowerCase().startsWith("select")) {
        return JSON.stringify({ error: "Only SELECT queries are allowed" });
      }
      try {
        const rawDb = db.getRawDb();
        const rows = rawDb.prepare(sql).all();
        return JSON.stringify(rows.slice(0, 50));
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : "Query failed" });
      }
    },

    create_issue: async (args) => {
      const title = String(args.title || "");
      const description = args.description ? String(args.description) : undefined;
      const priority = args.priority !== undefined && args.priority !== null ? Number(args.priority) : undefined;

      // Resolve assignee name to ID
      let assigneeId: string | undefined;
      if (args.assigneeName) {
        assigneeId = resolveMemberByName(String(args.assigneeName));
      }

      // Resolve label names to IDs
      let labelIds: string[] | undefined;
      if (args.labelNames && Array.isArray(args.labelNames) && args.labelNames.length > 0) {
        const resolved = await linear.listLabelsByName(args.labelNames.map(String));
        labelIds = resolved.map(l => l.id);
      }

      // Resolve project name to ID
      let projectId: string | undefined;
      if (args.projectName) {
        projectId = await resolveProjectByName(String(args.projectName));
      }

      // Get team ID
      const teamId = await linear.getTeamId(cfg.linearTeamKey);

      const issue = await linear.createIssue({
        teamId,
        title,
        description,
        priority,
        assigneeId,
        labelIds,
        projectId,
      });

      return JSON.stringify({
        success: true,
        issueId: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
      });
    },

    update_issue: async (args) => {
      const rawId = String(args.issueId || "");
      const issueId = resolveIssueId(rawId);

      const input: Record<string, unknown> = {};

      if (args.title !== undefined && args.title !== null) input.title = String(args.title);
      if (args.description !== undefined && args.description !== null) input.description = String(args.description);
      if (args.priority !== undefined && args.priority !== null) input.priority = Number(args.priority);

      if (args.assigneeName !== undefined && args.assigneeName !== null) {
        const assigneeId = resolveMemberByName(String(args.assigneeName));
        if (assigneeId) input.assigneeId = assigneeId;
      }

      if (args.status !== undefined && args.status !== null) {
        const stateId = await resolveStatusByName(String(args.status));
        if (stateId) input.stateId = stateId;
      }

      if (args.labelNames && Array.isArray(args.labelNames) && args.labelNames.length > 0) {
        const resolved = await linear.listLabelsByName(args.labelNames.map(String));
        input.labelIds = resolved.map(l => l.id);
      }

      if (args.projectName !== undefined && args.projectName !== null) {
        const projectId = await resolveProjectByName(String(args.projectName));
        if (projectId) input.projectId = projectId;
      }

      const result = await linear.updateIssue(issueId, input);

      return JSON.stringify({
        success: result.success,
        issueId: result.issue?.id || issueId,
        identifier: result.issue?.identifier || rawId,
        url: result.issue?.url,
      });
    },

    delete_issue: async (args) => {
      const rawId = String(args.issueId || "");
      const issueId = resolveIssueId(rawId);

      const result = await linear.deleteIssue(issueId);

      return JSON.stringify({
        success: result.success,
        identifier: rawId,
      });
    },

    add_comment: async (args) => {
      const rawId = String(args.issueId || "");
      const issueId = resolveIssueId(rawId);
      const body = String(args.body || "");

      const result = await linear.addIssueComment(issueId, body);

      return JSON.stringify({
        success: true,
        commentId: result.id,
        issueIdentifier: rawId,
        url: result.url,
      });
    },
  };
}
