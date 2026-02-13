import type {
  ActionProposal,
  BoardState, BoardMoveResult, ChatConversation, ChatMessage, ChatStreamEvent,
  Client, Cycle, CycleDetail, DashboardData, IssueWithState, OkrDoc,
  OkrAllocationView, PullRequest, PrReview, RiceScore, SyncStatus,
  TeamMember, TrackedMemberStatus, VelocityResponse, WipLimit,
} from "@linearapp/shared";

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (options?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Dashboard ───
export const getDashboard = () => request<DashboardData>("/dashboard");

// ─── Members ───
export const getMembers = () => request<{ members: (TeamMember & { wipCount: number })[] }>("/members");
export const getMember = (id: string) => request<{ member: TeamMember; issues: IssueWithState[]; pullRequests: PullRequest[]; reviews: PrReview[] }>(`/members/${id}`);
export const createMember = (data: Partial<TeamMember>) => request<{ ok: boolean; member: TeamMember }>("/members", { method: "POST", body: JSON.stringify(data) });
export const updateMember = (id: string, data: Partial<TeamMember>) => request<{ ok: boolean; member: TeamMember }>(`/members/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteMember = (id: string) => request<{ ok: boolean }>(`/members/${id}`, { method: "DELETE" });

// ─── Board ───
export const getBoard = () => request<BoardState>("/board");
export const moveCard = (data: { issueId: string; fromColumn: string; toColumn: string; position: number }) =>
  request<BoardMoveResult>("/board/move", { method: "PATCH", body: JSON.stringify(data) });
export const getWipLimits = () => request<WipLimit[]>("/board/wip-limits");
export const setWipLimit = (columnId: string, limit: number) =>
  request<{ ok: boolean }>("/board/wip-limits", { method: "PUT", body: JSON.stringify({ columnId, limit }) });

// ─── Cycles ───
export const getCycles = () => request<{ cycles: Cycle[] }>("/cycles");
export const getActiveCycle = () => request<CycleDetail>("/cycles/active");
export const getCycleDetail = (id: string) => request<CycleDetail>(`/cycles/${id}`);

// ─── OKRs ───
export const getOkrs = () => request<{ okrs: OkrDoc[] }>("/okrs");
export const getOkr = (id: string) => request<OkrDoc>(`/okrs/${id}`);
export const createOkr = (data: any) => request<{ ok: boolean; okr: OkrDoc }>("/okrs", { method: "POST", body: JSON.stringify(data) });
export const updateOkr = (id: string, data: any) => request<{ ok: boolean; okr: OkrDoc }>(`/okrs/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteOkr = (id: string) => request<{ ok: boolean }>(`/okrs/${id}`, { method: "DELETE" });
export const updateKeyResult = (krId: string, currentValue: number) =>
  request<{ ok: boolean }>(`/okrs/key-results/${krId}`, { method: "PATCH", body: JSON.stringify({ currentValue }) });
export const getOkrAllocation = () => request<{ allocations: OkrAllocationView[] }>("/okrs/allocation");

// ─── Issues ───
export const getIssues = (view: string) => request<{ items: IssueWithState[] }>(`/issues?view=${view}`);
export const searchIssues = (query: string) => request<{ items: IssueWithState[] }>(`/issues?search=${encodeURIComponent(query)}`);
export const getIssue = (id: string) => request<IssueWithState>(`/issues/${id}`);
export const updateRice = (id: string, rice: Omit<RiceScore, "score">) =>
  request<{ ok: boolean; rice: RiceScore }>(`/issues/${id}/rice`, { method: "PATCH", body: JSON.stringify(rice) });
export const bulkIssueAction = (data: { issueIds: string[]; action: string; boardColumn?: string; assigneeId?: string }) =>
  request<{ ok: boolean; updated: number }>("/issues/bulk", { method: "POST", body: JSON.stringify(data) });

// ─── GitHub ───
export const getGithubPrs = (filters?: { state?: string; repo?: string; authorLogin?: string }) => {
  const params = new URLSearchParams();
  if (filters?.state) params.set("state", filters.state);
  if (filters?.repo) params.set("repo", filters.repo);
  if (filters?.authorLogin) params.set("authorLogin", filters.authorLogin);
  return request<{ pullRequests: PullRequest[] }>(`/github/prs?${params}`);
};

// ─── Sync ───
export const getSyncStatus = () => request<SyncStatus>("/sync/status");
export const triggerSync = () => request<{ ok: boolean }>("/sync/refresh", { method: "POST" });

// ─── Enrichment ───
export const enrichIssue = (issueId: string) => request<{ ok: boolean; enrichment: any }>(`/enrich/${issueId}`, { method: "POST" });

// ─── Chat (SSE) ───
export const getConversations = () => request<{ conversations: ChatConversation[] }>("/chat/conversations");
export const createConversation = (title?: string) =>
  request<{ ok: boolean; conversation: ChatConversation }>("/chat/conversations", { method: "POST", body: JSON.stringify({ title }) });
export const getMessages = (conversationId: string) =>
  request<{ messages: ChatMessage[] }>(`/chat/conversations/${conversationId}/messages`);
export const deleteConversation = (id: string) =>
  request<{ ok: boolean }>(`/chat/conversations/${id}`, { method: "DELETE" });

export function streamChat(
  conversationId: string,
  message: string,
  onEvent: (event: ChatStreamEvent) => void,
): AbortController {
  const controller = new AbortController();

  fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, message }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6)) as ChatStreamEvent;
            onEvent(event);
          } catch { /* skip malformed */ }
        }
      }
    }
  }).catch((error) => {
    if (error.name !== "AbortError") {
      onEvent({ type: "error", error: error.message });
    }
  });

  return controller;
}

// ─── Actions/Approvals ───
export const approveAction = (proposalId: string) =>
  request<{ ok: boolean; proposal: ActionProposal }>(`/chat/actions/${proposalId}/approve`, { method: "POST" });

export const declineAction = (proposalId: string) =>
  request<{ ok: boolean; proposal: ActionProposal }>(`/chat/actions/${proposalId}/decline`, { method: "POST" });

export const retryAction = (proposalId: string) =>
  request<{ ok: boolean; proposal: ActionProposal }>(`/chat/actions/${proposalId}/retry`, { method: "POST" });

export const getConversationProposals = (conversationId: string) =>
  request<{ proposals: ActionProposal[] }>(`/chat/conversations/${conversationId}/proposals`);

// ─── Overview / Velocity ───
export const getVelocity = () => request<VelocityResponse>("/overview");
export const getVelocitySummary = () => request<{ ok: boolean; summary: string }>("/overview/summary", { method: "POST" });

// ─── Team Config ───
export const getTrackedMembers = () => request<{ trackedMembers: TrackedMemberStatus[] }>("/team-config");

// ─── Clients/Customers ───
export const getClients = (filters?: { tier?: string; active?: string }) => {
  const params = new URLSearchParams();
  if (filters?.tier) params.set("tier", filters.tier);
  if (filters?.active) params.set("active", filters.active);
  return request<{ ok: boolean; data: Client[] }>(`/clients?${params}`);
};
export const getClient = (id: number) => request<{ ok: boolean; data: Client }>(`/clients/${id}`);
export const updateClient = (id: number, data: { weight?: number; notes?: string; contractValue?: number }) =>
  request<{ ok: boolean; data: Client }>(`/clients/${id}`, { method: "PATCH", body: JSON.stringify(data) });

// ─── Health ───
export const getHealth = () => request<{ status: string; mode: string }>("/health");
