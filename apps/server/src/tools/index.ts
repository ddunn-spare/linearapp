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
  ["get_cycle_stats", { requiresApproval: false, category: "query", descriptionForUser: "Get cycle statistics with member breakdown" }],
  ["list_cycles", { requiresApproval: false, category: "query", descriptionForUser: "List all cycles with progress and dates" }],
  ["get_okrs", { requiresApproval: false, category: "query", descriptionForUser: "Get all OKRs with progress" }],
  ["get_github_prs", { requiresApproval: false, category: "query", descriptionForUser: "Get pull requests" }],
  ["find_similar_issues", { requiresApproval: false, category: "query", descriptionForUser: "Find issues similar to a query" }],
  ["calculate_rice", { requiresApproval: false, category: "query", descriptionForUser: "Calculate RICE score" }],
  ["evaluate_okr_fit", { requiresApproval: false, category: "query", descriptionForUser: "Evaluate OKR alignment for an issue" }],
  ["recommend_assignee", { requiresApproval: false, category: "query", descriptionForUser: "Recommend the best assignee for an issue" }],
  ["get_dashboard_summary", { requiresApproval: false, category: "query", descriptionForUser: "Get team dashboard summary" }],
  ["query_data", { requiresApproval: false, category: "query", descriptionForUser: "Run a read-only SQL query" }],
  ["get_clients", { requiresApproval: false, category: "query", descriptionForUser: "List clients/customers with tier and contract info" }],
  ["list_projects", { requiresApproval: false, category: "query", descriptionForUser: "List all projects with progress and issue counts" }],
  ["get_project_detail", { requiresApproval: false, category: "query", descriptionForUser: "Get project details with all issues in that project" }],
  ["update_client_weight", {
    requiresApproval: true,
    category: "action",
    actionCategory: "internal",
    descriptionForUser: "Update a client's weight, notes, or contract value",
    generatePreview: (args: Record<string, unknown>) => {
      const fields: ActionPreviewField[] = [];
      fields.push({ field: "Client ID", newValue: String(args.clientId || "") });
      if (args.weight !== undefined && args.weight !== null) fields.push({ field: "Weight", newValue: String(args.weight) });
      if (args.notes !== undefined && args.notes !== null) fields.push({ field: "Notes", newValue: String(args.notes).slice(0, 100) });
      if (args.contractValue !== undefined && args.contractValue !== null) fields.push({ field: "Contract Value", newValue: String(args.contractValue) });
      return fields;
    },
  }],
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
  ["manage_project", {
    requiresApproval: true,
    category: "action",
    actionCategory: "linear",
    descriptionForUser: "Create, update, or archive a Linear project",
    generatePreview: (args: Record<string, unknown>) => {
      const fields: ActionPreviewField[] = [];
      fields.push({ field: "Action", newValue: String(args.action || "create") });
      fields.push({ field: "Project", newValue: String(args.projectName || "") });
      if (args.description) fields.push({ field: "Description", newValue: String(args.description).slice(0, 100) + (String(args.description).length > 100 ? "..." : "") });
      if (args.newName) fields.push({ field: "New Name", newValue: String(args.newName) });
      return fields;
    },
  }],
  ["manage_cycle", {
    requiresApproval: true,
    category: "action",
    actionCategory: "linear",
    descriptionForUser: "Add or remove issues from a cycle",
    generatePreview: (args: Record<string, unknown>) => {
      const fields: ActionPreviewField[] = [];
      fields.push({ field: "Action", newValue: String(args.action || "add_issue") });
      fields.push({ field: "Issue", newValue: String(args.issueId || "") });
      if (args.cycleName) fields.push({ field: "Cycle", newValue: String(args.cycleName) });
      else fields.push({ field: "Cycle", newValue: "(active cycle)" });
      return fields;
    },
  }],
  ["manage_labels", {
    requiresApproval: true,
    category: "action",
    actionCategory: "linear",
    descriptionForUser: "Create labels or add/remove labels from issues",
    generatePreview: (args: Record<string, unknown>) => {
      const fields: ActionPreviewField[] = [];
      fields.push({ field: "Action", newValue: String(args.action || "create") });
      fields.push({ field: "Label", newValue: String(args.labelName || "") });
      if (args.issueId) fields.push({ field: "Issue", newValue: String(args.issueId) });
      if (args.color) fields.push({ field: "Color", newValue: String(args.color) });
      return fields;
    },
  }],
  ["bulk_update_issues", {
    requiresApproval: true,
    category: "action",
    actionCategory: "linear",
    descriptionForUser: "Update multiple Linear issues at once",
    generatePreview: (args: Record<string, unknown>) => {
      const fields: ActionPreviewField[] = [];
      const issueIds = Array.isArray(args.issueIds) ? args.issueIds.map(String) : [];
      fields.push({ field: "Issues", newValue: `${issueIds.slice(0, 5).join(", ")}${issueIds.length > 5 ? ` (+${issueIds.length - 5} more)` : ""} (${issueIds.length} issues)` });

      const updates = (args.updates || {}) as Record<string, unknown>;
      if (updates.priority !== undefined && updates.priority !== null) {
        const labels = ["None", "Urgent", "High", "Medium", "Low"];
        fields.push({ field: "Set Priority", newValue: labels[Number(updates.priority)] || "None" });
      }
      if (updates.assigneeName) fields.push({ field: "Set Assignee", newValue: String(updates.assigneeName) });
      if (updates.status) fields.push({ field: "Set Status", newValue: String(updates.status) });
      if (updates.labelNames && Array.isArray(updates.labelNames) && updates.labelNames.length > 0) {
        fields.push({ field: "Set Labels", newValue: (updates.labelNames as string[]).join(", ") });
      }
      if (updates.projectName) fields.push({ field: "Set Project", newValue: String(updates.projectName) });

      if (issueIds.length > 10) {
        fields.push({ field: "Warning", newValue: `Bulk operation affects ${issueIds.length} issues. Please review carefully.` });
      }

      return fields;
    },
  }],
  ["create_okr", {
    requiresApproval: true,
    category: "action",
    actionCategory: "okr",
    descriptionForUser: "Create a new OKR with key results",
    generatePreview: (args: Record<string, unknown>) => {
      const fields: ActionPreviewField[] = [];
      fields.push({ field: "Objective", newValue: String(args.objective || "") });
      fields.push({ field: "Quarter", newValue: String(args.quarter || "") });
      fields.push({ field: "Owner", newValue: String(args.owner || "") });
      if (args.keyResults && Array.isArray(args.keyResults)) {
        for (const kr of args.keyResults) {
          const krObj = kr as Record<string, unknown>;
          fields.push({ field: "Key Result", newValue: `${String(krObj.description || "")} (target: ${krObj.targetValue} ${krObj.unit || ""})` });
        }
      }
      return fields;
    },
  }],
  ["update_okr", {
    requiresApproval: true,
    category: "action",
    actionCategory: "okr",
    descriptionForUser: "Update an existing OKR or its key results",
    generatePreview: (args: Record<string, unknown>) => {
      const fields: ActionPreviewField[] = [];
      fields.push({ field: "OKR ID", newValue: String(args.okrId || "") });
      if (args.objective !== undefined && args.objective !== null) fields.push({ field: "Objective", oldValue: "(current)", newValue: String(args.objective) });
      if (args.quarter !== undefined && args.quarter !== null) fields.push({ field: "Quarter", oldValue: "(current)", newValue: String(args.quarter) });
      if (args.owner !== undefined && args.owner !== null) fields.push({ field: "Owner", oldValue: "(current)", newValue: String(args.owner) });
      if (args.status !== undefined && args.status !== null) fields.push({ field: "Status", oldValue: "(current)", newValue: String(args.status) });
      if (args.keyResults && Array.isArray(args.keyResults)) {
        fields.push({ field: "Key Results", newValue: `${args.keyResults.length} key results updated` });
      }
      return fields;
    },
  }],
  ["delete_okr", {
    requiresApproval: true,
    category: "action",
    actionCategory: "okr",
    destructive: true,
    descriptionForUser: "Delete an OKR and all its key results",
    // generatePreview is defined dynamically in createToolHandlers since it needs db access
  }],
  ["update_key_result", {
    requiresApproval: true,
    category: "action",
    actionCategory: "okr",
    descriptionForUser: "Update a key result's current progress value. When issues linked to a KR are completed, proactively suggest updating the KR progress based on the completion data.",
    generatePreview: (args: Record<string, unknown>) => {
      return [
        { field: "Key Result ID", newValue: String(args.keyResultId || "") },
        { field: "Current Value", newValue: String(args.currentValue ?? "") },
      ];
    },
  }],
  ["link_issue_to_kr", {
    requiresApproval: true,
    category: "action",
    actionCategory: "okr",
    descriptionForUser: "Link an issue to a key result for OKR tracking. Proactively suggest this when you notice an issue's work aligns with a key result based on title, description, or labels.",
    generatePreview: (args: Record<string, unknown>) => {
      const action = String(args.action || "link");
      return [
        { field: "Issue", newValue: String(args.issueId || "") },
        { field: "Key Result", newValue: String(args.keyResultId || "") },
        { field: "Action", newValue: action },
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

export function getWriteToolSummariesGrouped(): Map<string, { name: string; description: string }[]> {
  const groups = new Map<string, { name: string; description: string }[]>();
  for (const [name, meta] of toolMetadata) {
    if (meta.requiresApproval) {
      const category = meta.actionCategory || "internal";
      const group = groups.get(category) || [];
      group.push({ name, description: meta.descriptionForUser });
      groups.set(category, group);
    }
  }
  return groups;
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
        description: "Get cycle statistics including progress, member breakdown by assignee. Pass cycleId for a specific cycle, or null for the active cycle.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            cycleId: { type: ["string", "null"], description: "Cycle ID (null = active cycle)" },
          },
          required: ["cycleId"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_cycles",
        description: "List all cycles with name, dates, progress, and active status",
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
        name: "get_clients",
        description: "List clients/customers from Linear with tier, status, weight, and contract info",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            tier: { type: ["string", "null"], description: "Filter by tier name" },
            activeOnly: { type: ["boolean", "null"], description: "Only show active clients (default true)" },
          },
          required: ["tier", "activeOnly"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_projects",
        description: "List all projects with name, state, progress, issue counts, and dates",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            state: { type: ["string", "null"], description: "Filter by project state (e.g. started, planned, completed)" },
          },
          required: ["state"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_project_detail",
        description: "Get detailed project information including all issues in the project",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "Project ID" },
          },
          required: ["projectId"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_client_weight",
        description: "Update a client's weight (priority multiplier), notes, or contract value",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            clientId: { type: "number", description: "Client ID (local database ID)" },
            weight: { type: ["number", "null"], description: "Priority weight (0.1-10.0, default 1.0)" },
            notes: { type: ["string", "null"], description: "Internal notes about this client" },
            contractValue: { type: ["number", "null"], description: "Contract value in dollars" },
          },
          required: ["clientId", "weight", "notes", "contractValue"],
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
    {
      type: "function",
      function: {
        name: "manage_project",
        description: "Create, update, or archive a Linear project",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["create", "update", "archive"], description: "Action to perform on the project" },
            projectName: { type: "string", description: "Project name (for create/update/archive)" },
            description: { type: ["string", "null"], description: "Project description (for create/update)" },
            newName: { type: ["string", "null"], description: "New name for the project (for update/rename)" },
          },
          required: ["action", "projectName", "description", "newName"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "manage_cycle",
        description: "Add or remove issues from a Linear cycle",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["add_issue", "remove_issue"], description: "Action to perform" },
            issueId: { type: "string", description: "Issue ID or identifier (e.g. ENG-123)" },
            cycleName: { type: ["string", "null"], description: "Cycle name to target (null = active cycle)" },
          },
          required: ["action", "issueId", "cycleName"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "manage_labels",
        description: "Create labels or add/remove labels from issues",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["create", "add_to_issue", "remove_from_issue"], description: "Action to perform" },
            labelName: { type: "string", description: "Label name" },
            issueId: { type: ["string", "null"], description: "Issue ID or identifier (required for add/remove)" },
            color: { type: ["string", "null"], description: "Hex color for new label (e.g. #FF0000)" },
          },
          required: ["action", "labelName", "issueId", "color"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "bulk_update_issues",
        description: "Update multiple Linear issues at once with the same changes (priority, assignee, status, labels, project)",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            issueIds: {
              type: "array",
              items: { type: "string" },
              description: "Issue IDs or identifiers (e.g. [\"ENG-123\", \"ENG-456\"])",
            },
            updates: {
              type: "object",
              description: "Fields to update on all issues",
              properties: {
                priority: { type: ["number", "null"], description: "New priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)", enum: [0, 1, 2, 3, 4, null] },
                assigneeName: { type: ["string", "null"], description: "New assignee name" },
                status: { type: ["string", "null"], description: "New status name" },
                labelNames: { type: ["array", "null"], items: { type: "string" }, description: "New label names" },
                projectName: { type: ["string", "null"], description: "New project name" },
              },
              required: ["priority", "assigneeName", "status", "labelNames", "projectName"],
              additionalProperties: false,
            },
          },
          required: ["issueIds", "updates"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create_okr",
        description: "Create a new OKR with objective, quarter, owner, and key results",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            objective: { type: "string", description: "The OKR objective statement" },
            quarter: { type: "string", description: "Quarter (e.g. Q1 2026)" },
            owner: { type: "string", description: "Name of the OKR owner" },
            keyResults: {
              type: "array",
              description: "Key results for this OKR",
              items: {
                type: "object",
                properties: {
                  description: { type: "string", description: "Key result description" },
                  targetValue: { type: "number", description: "Target value to achieve" },
                  unit: { type: "string", description: "Unit of measurement (e.g. %, count, days)" },
                },
                required: ["description", "targetValue", "unit"],
                additionalProperties: false,
              },
            },
          },
          required: ["objective", "quarter", "owner", "keyResults"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_okr",
        description: "Update an existing OKR's fields or its key results",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            okrId: { type: "string", description: "OKR ID to update" },
            objective: { type: ["string", "null"], description: "New objective text" },
            quarter: { type: ["string", "null"], description: "New quarter" },
            owner: { type: ["string", "null"], description: "New owner name" },
            status: { type: ["string", "null"], description: "New status (e.g. active, completed)" },
            keyResults: {
              type: ["array", "null"],
              description: "Updated key results (replaces existing)",
              items: {
                type: "object",
                properties: {
                  id: { type: ["string", "null"], description: "Existing key result ID (null for new)" },
                  description: { type: "string", description: "Key result description" },
                  targetValue: { type: "number", description: "Target value" },
                  currentValue: { type: "number", description: "Current value" },
                  unit: { type: "string", description: "Unit of measurement" },
                },
                required: ["id", "description", "targetValue", "currentValue", "unit"],
                additionalProperties: false,
              },
            },
          },
          required: ["okrId", "objective", "quarter", "owner", "status", "keyResults"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_okr",
        description: "Permanently delete an OKR and all its key results. This action cannot be undone.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            okrId: { type: "string", description: "OKR ID to delete" },
          },
          required: ["okrId"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_key_result",
        description: "Update a key result's current progress value. When issues linked to a KR are completed, proactively suggest updating the KR progress based on the completion data.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            keyResultId: { type: "string", description: "Key result ID to update" },
            currentValue: { type: "number", description: "New current value for the key result" },
          },
          required: ["keyResultId", "currentValue"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "link_issue_to_kr",
        description: "Link an issue to a key result for OKR tracking. Proactively suggest this when you notice an issue's work aligns with a key result based on title, description, or labels.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            issueId: { type: "string", description: "Issue ID or identifier (e.g. ENG-123)" },
            keyResultId: { type: "string", description: "Key result ID to link/unlink" },
            action: { type: "string", enum: ["link", "unlink"], description: "Whether to link or unlink the issue" },
          },
          required: ["issueId", "keyResultId", "action"],
          additionalProperties: false,
        },
      },
    },
  ];
}

export function createToolHandlers(db: StateDb, linear: LinearGraphqlClient, cfg: AppConfig, trackedLinearIds?: Set<string>): Record<string, ToolHandler> {
  // Set up dynamic previews that need db access
  const deleteOkrMeta = toolMetadata.get("delete_okr");
  if (deleteOkrMeta) {
    deleteOkrMeta.generatePreview = (args: Record<string, unknown>) => {
      const okrId = String(args.okrId || "");
      const okr = db.getOkrById(okrId);
      if (okr) {
        return [
          { field: "Objective", newValue: okr.objective },
          { field: "Quarter", newValue: okr.quarter },
        ];
      }
      return [{ field: "OKR ID", newValue: okrId }];
    };
  }

  const updateKrMeta = toolMetadata.get("update_key_result");
  if (updateKrMeta) {
    updateKrMeta.generatePreview = (args: Record<string, unknown>) => {
      const keyResultId = String(args.keyResultId || "");
      const currentValue = args.currentValue;
      const okrs = db.getOkrs();
      for (const okr of okrs) {
        const kr = okr.keyResults.find(k => k.id === keyResultId);
        if (kr) {
          return [
            { field: "Key Result", newValue: kr.description },
            { field: "Current Value", oldValue: String(kr.currentValue), newValue: String(currentValue ?? "") },
            { field: "Target", newValue: `${kr.targetValue} ${kr.unit}` },
          ];
        }
      }
      return [
        { field: "Key Result ID", newValue: keyResultId },
        { field: "Current Value", newValue: String(currentValue ?? "") },
      ];
    };
  }

  const linkIssueMeta = toolMetadata.get("link_issue_to_kr");
  if (linkIssueMeta) {
    linkIssueMeta.generatePreview = (args: Record<string, unknown>) => {
      const issueId = String(args.issueId || "");
      const keyResultId = String(args.keyResultId || "");
      const action = String(args.action || "link");
      const okrs = db.getOkrs();
      let krDesc = keyResultId;
      for (const okr of okrs) {
        const kr = okr.keyResults.find(k => k.id === keyResultId);
        if (kr) { krDesc = kr.description; break; }
      }
      return [
        { field: "Issue", newValue: issueId },
        { field: "Key Result", newValue: krDesc },
        { field: "Action", newValue: action },
      ];
    };
  }

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

    get_cycle_stats: async (args) => {
      const cycleId = args.cycleId ? String(args.cycleId) : null;
      const cycle = cycleId ? db.getCycleById(cycleId) : db.getActiveCycle();
      if (!cycle) return JSON.stringify({ error: cycleId ? "Cycle not found" : "No active cycle found — cycles may not be synced or the team may be between cycles" });
      const issues = db.getIssuesByCycle(cycle.id);
      const completed = issues.filter(i => i.snapshot.boardColumn === "done").length;
      const inProgress = issues.filter(i => i.snapshot.boardColumn === "in_progress" || i.snapshot.boardColumn === "in_review").length;

      const now = new Date();
      const start = new Date(cycle.startsAt);
      const end = new Date(cycle.endsAt);
      const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      const elapsedDays = Math.max(0, Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
      const daysRemaining = Math.max(0, totalDays - elapsedDays);

      // Per-member breakdown
      const memberMap = new Map<string, { name: string; assigned: number; completed: number; inProgress: number; todo: number }>();
      for (const i of issues) {
        const assigneeId = i.snapshot.assigneeId || "unassigned";
        const assigneeName = i.snapshot.assigneeName || "Unassigned";
        if (!memberMap.has(assigneeId)) {
          memberMap.set(assigneeId, { name: assigneeName, assigned: 0, completed: 0, inProgress: 0, todo: 0 });
        }
        const m = memberMap.get(assigneeId)!;
        m.assigned++;
        if (i.snapshot.boardColumn === "done") m.completed++;
        else if (i.snapshot.boardColumn === "in_progress" || i.snapshot.boardColumn === "in_review") m.inProgress++;
        else m.todo++;
      }

      return JSON.stringify({
        id: cycle.id,
        name: cycle.name,
        number: cycle.number,
        progress: Math.round(cycle.progress * 100),
        totalIssues: issues.length,
        completed,
        inProgress,
        remaining: issues.length - completed,
        startsAt: cycle.startsAt,
        endsAt: cycle.endsAt,
        totalDays,
        elapsedDays,
        daysRemaining,
        isActive: cycle.isActive,
        completedScopeCount: cycle.completedScopeCount,
        totalScopeCount: cycle.totalScopeCount,
        memberBreakdown: Array.from(memberMap.entries()).map(([memberId, stats]) => ({
          memberId, ...stats,
        })),
      });
    },

    list_cycles: async () => {
      const cycles = db.getAllCycles();
      const now = new Date();
      return JSON.stringify(cycles.map(c => {
        const start = new Date(c.startsAt);
        const end = new Date(c.endsAt);
        const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
        const elapsedDays = Math.max(0, Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
        const daysRemaining = Math.max(0, totalDays - elapsedDays);
        return {
          id: c.id,
          name: c.name,
          number: c.number,
          startsAt: c.startsAt,
          endsAt: c.endsAt,
          progress: Math.round(c.progress * 100),
          completedScopeCount: c.completedScopeCount,
          totalScopeCount: c.totalScopeCount,
          isActive: c.isActive,
          totalDays,
          daysRemaining,
        };
      }));
    },

    get_clients: async (args) => {
      const tier = args.tier ? String(args.tier) : undefined;
      const activeOnly = args.activeOnly !== false;
      const clients = db.getClients({ tier, isActive: activeOnly ? true : undefined });
      return JSON.stringify(clients.map(c => ({
        id: c.id,
        name: c.name,
        tier: c.tier,
        status: c.status,
        weight: c.weight,
        contractValue: c.contractValue,
        revenue: c.revenue,
        domains: c.domains,
        ownerName: c.ownerName,
        notes: c.notes,
        isActive: c.isActive,
      })));
    },

    list_projects: async (args) => {
      const state = args.state ? String(args.state) : null;
      const projects = state ? db.getProjectsByState(state) : db.getAllProjects();
      return JSON.stringify(projects.map(p => ({
        id: p.id,
        name: p.name,
        state: p.state,
        progress: Math.round(p.progress * 100),
        issueCount: p.issueCount,
        completedIssueCount: p.completedIssueCount,
        startDate: p.startDate,
        targetDate: p.targetDate,
        url: p.url,
      })));
    },

    get_project_detail: async (args) => {
      const projectId = String(args.projectId || "");
      const project = db.getProjectById(projectId);
      if (!project) return JSON.stringify({ error: "Project not found" });
      // Get all issues in this project
      const allIssues = db.getAllIssues();
      const projectIssues = allIssues.filter(i => i.snapshot.projectId === projectId);
      return JSON.stringify({
        ...project,
        progress: Math.round(project.progress * 100),
        issues: projectIssues.map(i => ({
          issueId: i.snapshot.issueId,
          identifier: i.snapshot.identifier,
          title: i.snapshot.title,
          status: i.snapshot.status,
          boardColumn: i.snapshot.boardColumn,
          assigneeName: i.snapshot.assigneeName,
          priority: i.snapshot.priority,
        })),
      });
    },

    update_client_weight: async (args) => {
      const clientId = Number(args.clientId);
      const client = db.getClientById(clientId);
      if (!client) return JSON.stringify({ error: "Client not found" });

      const updates: { weight?: number; notes?: string; contractValue?: number } = {};
      if (args.weight !== undefined && args.weight !== null) updates.weight = Number(args.weight);
      if (args.notes !== undefined && args.notes !== null) updates.notes = String(args.notes);
      if (args.contractValue !== undefined && args.contractValue !== null) updates.contractValue = Number(args.contractValue);

      db.updateClientLocal(clientId, updates);
      return JSON.stringify({ success: true, clientId, name: client.name, updates });
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

    manage_project: async (args) => {
      const action = String(args.action || "create");
      const projectName = String(args.projectName || "");

      if (action === "create") {
        const teamId = await linear.getTeamId(cfg.linearTeamKey);
        const description = args.description ? String(args.description) : undefined;
        const project = await linear.createProject({
          teamIds: [teamId],
          name: projectName,
          description,
        });
        return JSON.stringify({
          success: true,
          projectId: project.id,
          name: project.name,
          url: project.url,
        });
      }

      // For update/archive: look up project by name
      const projects = await linear.listProjects(cfg.linearTeamKey);
      const lower = projectName.toLowerCase();
      const match = projects.find(p => p.name.toLowerCase() === lower)
        || projects.find(p => p.name.toLowerCase().includes(lower));
      if (!match) {
        return JSON.stringify({ error: `Project not found: ${projectName}` });
      }

      if (action === "archive") {
        const result = await linear.updateProject(match.id, { state: "canceled" });
        return JSON.stringify({ success: result.success, name: projectName });
      }

      // update
      const updateInput: { name?: string; description?: string } = {};
      if (args.newName) updateInput.name = String(args.newName);
      if (args.description !== undefined && args.description !== null) updateInput.description = String(args.description);
      const result = await linear.updateProject(match.id, updateInput);
      return JSON.stringify({ success: result.success, name: args.newName ? String(args.newName) : projectName });
    },

    manage_cycle: async (args) => {
      const action = String(args.action || "add_issue");
      const rawIssueId = String(args.issueId || "");
      const issueId = resolveIssueId(rawIssueId);

      if (action === "remove_issue") {
        const result = await linear.removeIssueFromCycle(issueId);
        return JSON.stringify({ success: result.success, issueIdentifier: rawIssueId, cycleName: null });
      }

      // add_issue: resolve cycle
      let cycleId: string | undefined;
      let cycleName: string = "(active cycle)";

      if (args.cycleName) {
        // Resolve cycle name to ID
        const cycles = await linear.listCyclesForTeam(cfg.linearTeamKey);
        const lower = String(args.cycleName).toLowerCase();
        const match = cycles.find(c => c.name.toLowerCase() === lower)
          || cycles.find(c => c.name.toLowerCase().includes(lower));
        if (match) {
          cycleId = match.id;
          cycleName = match.name;
        } else {
          return JSON.stringify({ error: `Cycle not found: ${args.cycleName}` });
        }
      } else {
        // Use active cycle from db
        const activeCycle = db.getActiveCycle();
        if (activeCycle) {
          cycleId = activeCycle.id;
          cycleName = activeCycle.name;
        } else {
          return JSON.stringify({ error: "No active cycle found" });
        }
      }

      const result = await linear.addIssueToCycle(issueId, cycleId!);
      return JSON.stringify({ success: result.success, issueIdentifier: rawIssueId, cycleName });
    },

    manage_labels: async (args) => {
      const action = String(args.action || "create");
      const labelName = String(args.labelName || "");

      if (action === "create") {
        const teamId = await linear.getTeamId(cfg.linearTeamKey);
        const color = args.color ? String(args.color) : undefined;
        const label = await linear.createLabel(teamId, labelName, color);
        return JSON.stringify({ success: true, labelId: label.id, labelName: label.name });
      }

      // add_to_issue / remove_from_issue
      const rawIssueId = String(args.issueId || "");
      if (!rawIssueId) {
        return JSON.stringify({ error: "issueId is required for add/remove label operations" });
      }
      const issueId = resolveIssueId(rawIssueId);

      // Get current labels on the issue
      const currentLabels = await linear.getIssueLabels(issueId);
      const currentLabelIds = currentLabels.map(l => l.id);

      if (action === "add_to_issue") {
        // Find the label by name
        const resolved = await linear.listLabelsByName([labelName]);
        const foundLabel = resolved[0];
        if (!foundLabel) {
          return JSON.stringify({ error: `Label not found: ${labelName}` });
        }
        const targetLabelId = foundLabel.id;
        // Add if not already present
        const newLabelIds = currentLabelIds.includes(targetLabelId)
          ? currentLabelIds
          : [...currentLabelIds, targetLabelId];
        const result = await linear.updateIssue(issueId, { labelIds: newLabelIds });
        return JSON.stringify({ success: result.success, labelName, issueIdentifier: rawIssueId });
      }

      // remove_from_issue
      const resolved = await linear.listLabelsByName([labelName]);
      const foundLabel = resolved[0];
      if (!foundLabel) {
        return JSON.stringify({ error: `Label not found: ${labelName}` });
      }
      const targetLabelId = foundLabel.id;
      const newLabelIds = currentLabelIds.filter(id => id !== targetLabelId);
      const result = await linear.updateIssue(issueId, { labelIds: newLabelIds });
      return JSON.stringify({ success: result.success, labelName, issueIdentifier: rawIssueId });
    },

    bulk_update_issues: async (args) => {
      const issueIds = Array.isArray(args.issueIds) ? args.issueIds.map(String) : [];
      if (issueIds.length === 0) {
        return JSON.stringify({ error: "At least one issue ID is required" });
      }

      if (issueIds.length > 10) {
        // Soft cap: log warning but proceed
        console.warn(`[bulk_update_issues] Large batch: ${issueIds.length} issues`);
      }

      const updates = (args.updates || {}) as Record<string, unknown>;

      // Resolve shared values once
      let assigneeId: string | undefined;
      if (updates.assigneeName) {
        assigneeId = resolveMemberByName(String(updates.assigneeName));
      }

      let stateId: string | undefined;
      if (updates.status) {
        stateId = await resolveStatusByName(String(updates.status));
      }

      let labelIds: string[] | undefined;
      if (updates.labelNames && Array.isArray(updates.labelNames) && updates.labelNames.length > 0) {
        const resolved = await linear.listLabelsByName((updates.labelNames as string[]).map(String));
        labelIds = resolved.map(l => l.id);
      }

      let projectId: string | undefined;
      if (updates.projectName) {
        projectId = await resolveProjectByName(String(updates.projectName));
      }

      const results: Array<{ issueId: string; identifier: string; success: boolean; url?: string }> = [];
      const failures: Array<{ issueId: string; identifier: string; error: string }> = [];

      for (const rawId of issueIds) {
        const resolvedId = resolveIssueId(rawId);
        const input: Record<string, unknown> = {};

        if (updates.priority !== undefined && updates.priority !== null) input.priority = Number(updates.priority);
        if (assigneeId) input.assigneeId = assigneeId;
        if (stateId) input.stateId = stateId;
        if (labelIds) input.labelIds = labelIds;
        if (projectId) input.projectId = projectId;

        try {
          const result = await linear.updateIssue(resolvedId, input);
          results.push({
            issueId: result.issue?.id || resolvedId,
            identifier: result.issue?.identifier || rawId,
            success: result.success,
            url: result.issue?.url,
          });
        } catch (error) {
          failures.push({
            issueId: resolvedId,
            identifier: rawId,
            error: error instanceof Error ? error.message : "Update failed",
          });
        }
      }

      const totalCount = issueIds.length;
      const successCount = results.length;
      const failedCount = failures.length;

      if (failedCount === 0) {
        return JSON.stringify({
          success: true,
          updatedCount: successCount,
          results,
        });
      }

      if (successCount === 0) {
        return JSON.stringify({
          success: false,
          error: "All updates failed",
          failedCount,
          failures,
        });
      }

      // Partial success
      return JSON.stringify({
        partialSuccess: true,
        updatedCount: successCount,
        failedCount,
        totalCount,
        results,
        failures,
      });
    },

    create_okr: async (args) => {
      const objective = String(args.objective || "");
      const quarter = String(args.quarter || "");
      const owner = String(args.owner || "");
      const rawKRs = args.keyResults as Array<{ description: string; targetValue: number; unit: string }>;

      if (!rawKRs || rawKRs.length === 0) {
        return JSON.stringify({ error: "At least one key result is required" });
      }

      const now = new Date().toISOString();
      const okrId = crypto.randomUUID();

      const keyResults = rawKRs.map((kr, i) => ({
        id: `${okrId}-kr-${i}`,
        okrId,
        description: kr.description,
        targetValue: kr.targetValue,
        currentValue: 0,
        unit: kr.unit,
        progress: 0,
      }));

      const okrDoc = {
        okrId,
        quarter,
        owner,
        status: "active",
        objective,
        keyResults,
        progress: 0,
        issueCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      db.upsertOkr(okrDoc);
      return JSON.stringify({ success: true, okrId, objective });
    },

    update_okr: async (args) => {
      const okrId = String(args.okrId || "");
      const existing = db.getOkrById(okrId);
      if (!existing) {
        return JSON.stringify({ error: "OKR not found" });
      }

      const now = new Date().toISOString();

      // Merge fields
      const objective = (args.objective !== undefined && args.objective !== null) ? String(args.objective) : existing.objective;
      const quarter = (args.quarter !== undefined && args.quarter !== null) ? String(args.quarter) : existing.quarter;
      const owner = (args.owner !== undefined && args.owner !== null) ? String(args.owner) : existing.owner;
      const status = (args.status !== undefined && args.status !== null) ? String(args.status) : existing.status;

      // Merge key results
      let keyResults = existing.keyResults;
      if (args.keyResults && Array.isArray(args.keyResults)) {
        const rawKRs = args.keyResults as Array<{ id: string | null; description: string; targetValue: number; currentValue: number; unit: string }>;
        keyResults = rawKRs.map((kr, i) => {
          const progress = kr.targetValue > 0 ? (kr.currentValue / kr.targetValue) * 100 : 0;
          return {
            id: kr.id || `${okrId}-kr-${i}`,
            okrId,
            description: kr.description,
            targetValue: kr.targetValue,
            currentValue: kr.currentValue,
            unit: kr.unit,
            progress,
          };
        });
      }

      const avgProgress = keyResults.length > 0
        ? keyResults.reduce((s, k) => s + k.progress, 0) / keyResults.length
        : 0;

      const updated = {
        ...existing,
        objective,
        quarter,
        owner,
        status,
        keyResults,
        progress: avgProgress,
        updatedAt: now,
      };

      db.upsertOkr(updated);
      return JSON.stringify({ success: true, okrId, objective });
    },

    delete_okr: async (args) => {
      const okrId = String(args.okrId || "");
      const existing = db.getOkrById(okrId);
      if (!existing) {
        return JSON.stringify({ error: "OKR not found" });
      }

      db.deleteOkr(okrId);
      return JSON.stringify({ success: true, okrId, objective: existing.objective });
    },

    update_key_result: async (args) => {
      const keyResultId = String(args.keyResultId || "");
      const currentValue = Number(args.currentValue);

      db.updateKeyResultProgress(keyResultId, currentValue);
      return JSON.stringify({ success: true, keyResultId, currentValue });
    },

    link_issue_to_kr: async (args) => {
      const rawIssueId = String(args.issueId || "");
      const issueId = resolveIssueId(rawIssueId);
      const keyResultId = String(args.keyResultId || "");
      const action = String(args.action || "link");

      // Look up the key result to find its parent OKR
      const okrs = db.getOkrs();
      let parentOkrId: string | undefined;
      for (const okr of okrs) {
        if (okr.keyResults.some(kr => kr.id === keyResultId)) {
          parentOkrId = okr.okrId;
          break;
        }
      }
      if (!parentOkrId && action === "link") {
        return JSON.stringify({ error: "Key result not found" });
      }

      // Get or create enrichment for this issue
      const existingEnrichment = db.getEnrichment(issueId);
      if (action === "link") {
        const okr = db.getOkrById(parentOkrId!);
        const enrichment = existingEnrichment || {
          issueId,
          similarIssueIds: [],
          reasoning: "",
          generatedAt: new Date().toISOString(),
          provider: "heuristic" as const,
        };
        enrichment.okrId = parentOkrId;
        enrichment.okrObjective = okr?.objective;
        enrichment.generatedAt = new Date().toISOString();
        db.saveEnrichment(enrichment);
      } else {
        // Unlink
        if (existingEnrichment) {
          existingEnrichment.okrId = undefined;
          existingEnrichment.okrObjective = undefined;
          existingEnrichment.generatedAt = new Date().toISOString();
          db.saveEnrichment(existingEnrichment);
        }
      }

      // Recalculate OKR issue count
      if (parentOkrId) {
        const allIssues = db.getAllIssues();
        const linkedCount = allIssues.filter(i => i.enrichment?.okrId === parentOkrId).length;
        const okrDoc = db.getOkrById(parentOkrId);
        if (okrDoc) {
          okrDoc.issueCount = linkedCount;
          okrDoc.updatedAt = new Date().toISOString();
          db.upsertOkr(okrDoc);
        }
      }

      return JSON.stringify({
        success: true,
        issueIdentifier: rawIssueId,
        keyResultId,
        action,
      });
    },
  };
}
