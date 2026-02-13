import type { AppConfig } from "../config";

type GraphQlResponse<T> = { data?: T; errors?: Array<{ message: string }> };

const unwrapConnection = <T>(input: { nodes?: T[] } | undefined): T[] =>
  input?.nodes && Array.isArray(input.nodes) ? input.nodes : [];

export type LinearStatus = { id: string; name: string; type: string };
export type LinearUser = { id: string; name: string; email?: string; avatarUrl?: string };
export type LinearCycle = {
  id: string; name: string; number: number; startsAt: string; endsAt: string;
  completedScopeCount: number; scopeCount: number; progress: number;
};
export type LinearIssue = {
  id: string; identifier: string; title: string; description?: string; url: string;
  createdAt: string; updatedAt: string; completedAt?: string; estimate?: number; priority?: number;
  statusId?: string; status: string; statusType: string;
  assigneeId?: string; assigneeName?: string; labels: string[];
  projectId?: string; projectName?: string; teamId: string; teamKey: string;
  cycleId?: string; cycleName?: string;
};

export class LinearGraphqlClient {
  constructor(private readonly cfg: AppConfig) {}

  get hasKey(): boolean {
    return Boolean(this.cfg.linearApiKey);
  }

  private async query<TData>(query: string, variables: Record<string, unknown>): Promise<TData> {
    if (!this.cfg.linearApiKey) throw new Error("LINEAR_API_KEY is not configured");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.cfg.linearApiTimeoutMs);
    let response: Response;
    try {
      response = await fetch(this.cfg.linearApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: this.cfg.linearApiKey },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        throw new Error(`Linear API timed out after ${this.cfg.linearApiTimeoutMs}ms`);
      throw new Error(`Linear API request failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`Linear API ${response.status}`);
    const payload = (await response.json()) as GraphQlResponse<TData>;
    if (payload.errors?.length) throw new Error(`Linear GQL: ${payload.errors.map(e => e.message).join("; ")}`);
    if (!payload.data) throw new Error("Linear API empty response");
    return payload.data;
  }

  async listStatuses(teamKey: string): Promise<LinearStatus[]> {
    const data = await this.query<{
      teams: { nodes: Array<{ states: { nodes: Array<{ id: string; name: string; type: string }> } }> };
    }>(`query($teamKey:String!){teams(filter:{key:{eq:$teamKey}},first:1){nodes{states{nodes{id name type}}}}}`, { teamKey });
    return unwrapConnection(data.teams.nodes[0]?.states);
  }

  async listUsers(teamKey: string): Promise<LinearUser[]> {
    const data = await this.query<{
      teams: { nodes: Array<{ members: { nodes: Array<{ id: string; name: string; email?: string; avatarUrl?: string }> } }> };
    }>(`query($teamKey:String!){teams(filter:{key:{eq:$teamKey}},first:1){nodes{members{nodes{id name email avatarUrl}}}}}`, { teamKey });
    return unwrapConnection(data.teams.nodes[0]?.members);
  }

  async listCycles(teamKey: string): Promise<LinearCycle[]> {
    try {
      const data = await this.query<{
        teams: { nodes: Array<{ cycles: { nodes: Array<{
          id: string; name?: string; number: number; startsAt: string; endsAt: string;
          completedScopeCount: number; scopeCount: number; progress: number;
        }> } }> };
      }>(`query($teamKey:String!){teams(filter:{key:{eq:$teamKey}},first:1){nodes{cycles(first:10){nodes{id number startsAt endsAt completedScopeCount scopeCount progress}}}}}`, { teamKey });
      return unwrapConnection(data.teams.nodes[0]?.cycles).map(c => ({ ...c, name: c.name || `Cycle ${c.number}` }));
    } catch {
      return []; // Cycles are optional — don't fail sync
    }
  }

  async listIssues(teamKey: string, limit: number): Promise<LinearIssue[]> {
    type IssueNode = {
      id: string; identifier: string; title: string; description?: string; url: string;
      createdAt: string; updatedAt: string; completedAt?: string; estimate?: number; priority?: number;
      state?: { id: string; name: string; type: string };
      assignee?: { id: string; name: string };
      labels?: { nodes: Array<{ name: string }> };
      project?: { id: string; name: string };
      team: { id: string; key: string };
      cycle?: { id: string; name: string };
    };

    const results: IssueNode[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage && results.length < limit) {
      const pageSize = Math.min(100, limit - results.length);
      const resp: { issues: { nodes: IssueNode[]; pageInfo: { hasNextPage: boolean; endCursor?: string } } } = await this.query(`query($teamKey:String!,$first:Int!,$after:String){issues(first:$first,after:$after,orderBy:updatedAt,filter:{team:{key:{eq:$teamKey}}}){nodes{id identifier title description url createdAt updatedAt completedAt estimate priority state{id name type}assignee{id name}labels{nodes{name}}project{id name}team{id key}}pageInfo{hasNextPage endCursor}}}`,
        { teamKey, first: pageSize, after: cursor });

      results.push(...resp.issues.nodes);
      hasNextPage = resp.issues.pageInfo.hasNextPage;
      cursor = resp.issues.pageInfo.endCursor ?? null;
      if (!cursor) hasNextPage = false;
    }

    return results.map(i => ({
      id: i.id, identifier: i.identifier, title: i.title, description: i.description,
      url: i.url, createdAt: i.createdAt, updatedAt: i.updatedAt,
      completedAt: i.completedAt, estimate: i.estimate, priority: i.priority,
      statusId: i.state?.id, status: i.state?.name || "Unknown",
      statusType: i.state?.type || "unknown",
      assigneeId: i.assignee?.id, assigneeName: i.assignee?.name,
      labels: unwrapConnection(i.labels).map(l => l.name),
      projectId: i.project?.id, projectName: i.project?.name,
      teamId: i.team.id, teamKey: i.team.key,
      cycleId: i.cycle?.id, cycleName: i.cycle?.name,
    }));
  }

  async updateIssueStatus(issueId: string, stateId: string): Promise<{ success: boolean }> {
    const data = await this.query<{ issueUpdate: { success: boolean } }>(
      `mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success}}`,
      { id: issueId, input: { stateId } }
    );
    return { success: data.issueUpdate.success };
  }

  async listLabelsByName(names: string[]): Promise<Array<{ id: string; name: string }>> {
    if (!names.length) return [];
    const data = await this.query<{ issueLabels: { nodes: Array<{ id: string; name: string }> } }>(
      `query($names:[String!]){issueLabels(filter:{name:{in:$names}},first:100){nodes{id name}}}`,
      { names }
    );
    return data.issueLabels.nodes;
  }

  // ─── Mutation Methods ───

  private teamIdCache = new Map<string, string>();

  async getTeamId(teamKey: string): Promise<string> {
    const cached = this.teamIdCache.get(teamKey);
    if (cached) return cached;
    const data = await this.query<{
      teams: { nodes: Array<{ id: string }> };
    }>(`query($teamKey:String!){teams(filter:{key:{eq:$teamKey}},first:1){nodes{id}}}`, { teamKey });
    const team = data.teams.nodes[0];
    if (!team) throw new Error(`Team not found for key: ${teamKey}`);
    this.teamIdCache.set(teamKey, team.id);
    return team.id;
  }

  async listProjects(teamKey: string): Promise<Array<{ id: string; name: string }>> {
    const data = await this.query<{
      teams: { nodes: Array<{ projects: { nodes: Array<{ id: string; name: string }> } }> };
    }>(`query($teamKey:String!){teams(filter:{key:{eq:$teamKey}},first:1){nodes{projects{nodes{id name}}}}}`, { teamKey });
    return unwrapConnection(data.teams.nodes[0]?.projects);
  }

  async createIssue(params: {
    teamId: string;
    title: string;
    description?: string;
    priority?: number;
    assigneeId?: string;
    stateId?: string;
    labelIds?: string[];
    projectId?: string;
    cycleId?: string;
  }): Promise<{ id: string; identifier: string; url: string; title: string }> {
    const input: Record<string, unknown> = {
      teamId: params.teamId,
      title: params.title,
    };
    if (params.description !== undefined) input.description = params.description;
    if (params.priority !== undefined) input.priority = params.priority;
    if (params.assigneeId !== undefined) input.assigneeId = params.assigneeId;
    if (params.stateId !== undefined) input.stateId = params.stateId;
    if (params.labelIds?.length) input.labelIds = params.labelIds;
    if (params.projectId !== undefined) input.projectId = params.projectId;
    if (params.cycleId !== undefined) input.cycleId = params.cycleId;

    const data = await this.query<{
      issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string; title: string } };
    }>(
      `mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{id identifier url title}}}`,
      { input }
    );

    if (!data.issueCreate.success) throw new Error("Linear issueCreate failed");
    return data.issueCreate.issue;
  }

  async updateIssue(
    issueId: string,
    input: {
      title?: string;
      description?: string;
      priority?: number;
      assigneeId?: string;
      stateId?: string;
      labelIds?: string[];
      projectId?: string;
      cycleId?: string;
    },
  ): Promise<{ success: boolean; issue?: { id: string; identifier: string; url: string } }> {
    // Only send defined fields
    const cleanInput: Record<string, unknown> = {};
    if (input.title !== undefined) cleanInput.title = input.title;
    if (input.description !== undefined) cleanInput.description = input.description;
    if (input.priority !== undefined) cleanInput.priority = input.priority;
    if (input.assigneeId !== undefined) cleanInput.assigneeId = input.assigneeId;
    if (input.stateId !== undefined) cleanInput.stateId = input.stateId;
    if (input.labelIds !== undefined) cleanInput.labelIds = input.labelIds;
    if (input.projectId !== undefined) cleanInput.projectId = input.projectId;
    if (input.cycleId !== undefined) cleanInput.cycleId = input.cycleId;

    const data = await this.query<{
      issueUpdate: { success: boolean; issue: { id: string; identifier: string; url: string } };
    }>(
      `mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success issue{id identifier url}}}`,
      { id: issueId, input: cleanInput }
    );

    return { success: data.issueUpdate.success, issue: data.issueUpdate.issue };
  }

  async deleteIssue(issueId: string): Promise<{ success: boolean }> {
    const data = await this.query<{ issueDelete: { success: boolean } }>(
      `mutation($id:String!){issueDelete(id:$id){success}}`,
      { id: issueId }
    );
    return { success: data.issueDelete.success };
  }

  async addIssueComment(issueId: string, body: string): Promise<{ id: string; url?: string }> {
    const data = await this.query<{
      commentCreate: { success: boolean; comment: { id: string; url: string } };
    }>(
      `mutation($input:CommentCreateInput!){commentCreate(input:$input){success comment{id url}}}`,
      { input: { issueId, body } }
    );

    if (!data.commentCreate.success) throw new Error("Linear commentCreate failed");
    return { id: data.commentCreate.comment.id, url: data.commentCreate.comment.url };
  }

  // ─── Project Mutations ───

  async createProject(params: {
    teamIds: string[];
    name: string;
    description?: string;
    state?: string;
  }): Promise<{ id: string; name: string; url: string }> {
    const input: Record<string, unknown> = {
      teamIds: params.teamIds,
      name: params.name,
    };
    if (params.description !== undefined) input.description = params.description;
    if (params.state !== undefined) input.state = params.state;

    const data = await this.query<{
      projectCreate: { success: boolean; project: { id: string; name: string; url: string } };
    }>(
      `mutation($input:ProjectCreateInput!){projectCreate(input:$input){success project{id name url}}}`,
      { input }
    );

    if (!data.projectCreate.success) throw new Error("Linear projectCreate failed");
    return data.projectCreate.project;
  }

  async updateProject(
    projectId: string,
    input: { name?: string; description?: string; state?: string },
  ): Promise<{ success: boolean }> {
    const cleanInput: Record<string, unknown> = {};
    if (input.name !== undefined) cleanInput.name = input.name;
    if (input.description !== undefined) cleanInput.description = input.description;
    if (input.state !== undefined) cleanInput.state = input.state;

    const data = await this.query<{
      projectUpdate: { success: boolean };
    }>(
      `mutation($id:String!,$input:ProjectUpdateInput!){projectUpdate(id:$id,input:$input){success}}`,
      { id: projectId, input: cleanInput }
    );

    return { success: data.projectUpdate.success };
  }

  // ─── Cycle Issue Mutations ───

  async addIssueToCycle(issueId: string, cycleId: string): Promise<{ success: boolean }> {
    return this.updateIssue(issueId, { cycleId });
  }

  async removeIssueFromCycle(issueId: string): Promise<{ success: boolean }> {
    // Linear API: setting cycleId to null removes the issue from its cycle
    const data = await this.query<{
      issueUpdate: { success: boolean };
    }>(
      `mutation($id:String!,$input:IssueUpdateInput!){issueUpdate(id:$id,input:$input){success}}`,
      { id: issueId, input: { cycleId: null } }
    );
    return { success: data.issueUpdate.success };
  }

  // ─── Label Mutations ───

  async createLabel(
    teamId: string,
    name: string,
    color?: string,
  ): Promise<{ id: string; name: string }> {
    const input: Record<string, unknown> = { teamId, name };
    if (color !== undefined) input.color = color;

    const data = await this.query<{
      issueLabelCreate: { success: boolean; issueLabel: { id: string; name: string } };
    }>(
      `mutation($input:IssueLabelCreateInput!){issueLabelCreate(input:$input){success issueLabel{id name}}}`,
      { input }
    );

    if (!data.issueLabelCreate.success) throw new Error("Linear issueLabelCreate failed");
    return data.issueLabelCreate.issueLabel;
  }

  // ─── Cycle Queries (extended) ───

  async listCyclesForTeam(teamKey: string): Promise<Array<{ id: string; name: string; number: number; startsAt: string; endsAt: string }>> {
    try {
      const data = await this.query<{
        teams: { nodes: Array<{ cycles: { nodes: Array<{
          id: string; name?: string; number: number; startsAt: string; endsAt: string;
        }> } }> };
      }>(`query($teamKey:String!){teams(filter:{key:{eq:$teamKey}},first:1){nodes{cycles(first:50,orderBy:createdAt){nodes{id name number startsAt endsAt}}}}}`, { teamKey });
      return unwrapConnection(data.teams.nodes[0]?.cycles).map(c => ({
        id: c.id,
        name: c.name || `Cycle ${c.number}`,
        number: c.number,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
      }));
    } catch {
      return [];
    }
  }

  // ─── Label Queries (for issue label management) ───

  async getIssueLabels(issueId: string): Promise<Array<{ id: string; name: string }>> {
    const data = await this.query<{
      issue: { labels: { nodes: Array<{ id: string; name: string }> } };
    }>(
      `query($id:String!){issue(id:$id){labels{nodes{id name}}}}`,
      { id: issueId }
    );
    return data.issue?.labels?.nodes || [];
  }
}
