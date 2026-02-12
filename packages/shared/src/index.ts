// ─── Views & Enums ───

export type IssueView = "triage" | "backlog" | "inprogress" | "done";

export type BoardColumnId = "backlog" | "todo" | "in_progress" | "in_review" | "done";

export type Difficulty = "XS" | "S" | "M" | "L" | "XL";

export type SyncMode = "api" | "none";

export type AiProvider = "openai" | "heuristic";

// ─── Team Members ───

export type TeamMember = {
  id: string;
  linearUserId?: string;
  githubUsername?: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  role?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

// ─── Issues / Snapshots ───

export type CapacitySignals = {
  inProgressCount: number;
  activeEstimateLoad: number;
};

export type IssueSnapshot = {
  issueId: string;
  identifier: string;
  title: string;
  description?: string;
  url: string;
  status: string;
  statusType: string;
  boardColumn: BoardColumnId;
  assigneeId?: string;
  assigneeName?: string;
  estimate?: number;
  labels: string[];
  priority?: number;
  projectId?: string;
  projectName?: string;
  teamId: string;
  teamKey: string;
  updatedAt: string;
  completedAt?: string;
  createdAt: string;
  cycleId?: string;
  cycleName?: string;
};

export type RiceScore = {
  reach: number;
  impact: number;
  confidence: number;
  effort: number;
  score: number;
};

export type IssueEnrichment = {
  issueId: string;
  recommendedAssigneeId?: string;
  recommendedAssigneeName?: string;
  okrId?: string;
  okrObjective?: string;
  difficulty?: Difficulty;
  rice?: RiceScore;
  similarIssueIds: string[];
  reasoning: string;
  generatedAt: string;
  provider: AiProvider;
};

export type IssueDraft = {
  issueId: string;
  editedValues: {
    assigneeId?: string;
    status?: string;
    estimate?: number;
    labels?: string[];
    projectId?: string;
  };
  fieldSelections: {
    assignee: boolean;
    status: boolean;
    estimate: boolean;
    labels: boolean;
    project: boolean;
  };
  updatedAt: string;
};

export type IssueWithState = {
  snapshot: IssueSnapshot;
  enrichment?: IssueEnrichment;
  draft?: IssueDraft;
  hasPendingChanges: boolean;
  pullRequests?: PullRequest[];
};

// ─── Cycles ───

export type Cycle = {
  id: string;
  name: string;
  number: number;
  startsAt: string;
  endsAt: string;
  completedScopeCount: number;
  totalScopeCount: number;
  progress: number;
  isActive: boolean;
};

export type CycleDetail = {
  cycle: Cycle;
  burndown: BurndownPoint[];
  memberBreakdown: CycleMemberBreakdown[];
  rolloverRisk: RolloverRiskItem[];
};

export type BurndownPoint = {
  date: string;
  ideal: number;
  actual: number;
  completed: number;
};

export type CycleMemberBreakdown = {
  memberId: string;
  memberName: string;
  assigned: number;
  completed: number;
  inProgress: number;
  todo: number;
};

export type RolloverRiskItem = {
  issueId: string;
  identifier: string;
  title: string;
  assigneeName?: string;
  status: string;
  daysInStatus: number;
  reason: string;
};

// ─── OKRs ───

export type KeyResult = {
  id: string;
  okrId: string;
  description: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  progress: number;
};

export type OkrDoc = {
  okrId: string;
  quarter: string;
  owner: string;
  status: string;
  objective: string;
  keyResults: KeyResult[];
  progress: number;
  issueCount: number;
  createdAt: string;
  updatedAt: string;
};

export type OkrInput = {
  okrId?: string;
  quarter: string;
  owner: string;
  status: string;
  objective: string;
  keyResults: Omit<KeyResult, "id" | "okrId" | "progress">[];
};

export type OkrAllocationView = {
  okrId: string;
  objective: string;
  issueCount: number;
  completedCount: number;
  memberIds: string[];
};

// ─── GitHub / Pull Requests ───

export type PullRequest = {
  id: string;
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  authorLogin: string;
  authorAvatarUrl?: string;
  repo: string;
  branchName: string;
  linkedIssueId?: string;
  linkedIssueIdentifier?: string;
  additions: number;
  deletions: number;
  reviewStatus: PrReviewStatus;
  reviews: PrReview[];
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
};

export type PrReviewStatus = "approved" | "changes_requested" | "pending" | "none";

export type PrReview = {
  id: string;
  prId: string;
  reviewerLogin: string;
  state: "approved" | "changes_requested" | "commented" | "pending" | "dismissed";
  submittedAt: string;
};

// ─── Board ───

export type WipLimit = {
  columnId: BoardColumnId;
  limit: number;
};

export type BoardState = {
  columns: BoardColumn[];
  wipLimits: WipLimit[];
};

export type BoardColumn = {
  id: BoardColumnId;
  label: string;
  issues: IssueWithState[];
  wipLimit: number;
  wipCount: number;
};

export type BoardMoveRequest = {
  issueId: string;
  fromColumn: BoardColumnId;
  toColumn: BoardColumnId;
  position: number;
};

export type BoardMoveResult = {
  success: boolean;
  wipExceeded: boolean;
  issue?: IssueWithState;
  error?: string;
};

// ─── Dashboard ───

export type DashboardData = {
  stats: DashboardStats;
  members: DashboardMember[];
};

export type DashboardStats = {
  inFlight: number;
  completedThisCycle: number;
  blocked: number;
  okrProgress: number;
  cycleProgress: number;
  cycleName: string;
};

export type DashboardMember = {
  id: string;
  name: string;
  avatarUrl?: string;
  wipCount: number;
  cycleProgress: number;
  status: "green" | "yellow" | "red";
  currentIssues: { identifier: string; title: string; boardColumn: BoardColumnId }[];
};

// ─── Sync ───

export type SyncStatus = {
  lastSuccessfulSync?: string;
  lastAttemptedSync?: string;
  runningJobs: string[];
  mode: SyncMode;
  errors: string[];
};

// ─── Chat ───

export type ChatConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ChatToolCall[];
  actionProposals?: ActionProposal[];
  createdAt: string;
};

export type ChatToolCall = {
  id: string;
  name: string;
  arguments: string;
  result?: string;
};

export type ChatStreamEvent =
  | { type: "delta"; content: string }
  | { type: "tool_call_start"; toolCall: { id: string; name: string } }
  | { type: "tool_call_result"; toolCall: { id: string; name: string; result: string } }
  | { type: "action_proposed"; proposal: ActionProposal }
  | { type: "action_update"; proposalId: string; state: ActionState; result?: string; resultUrl?: string; error?: string }
  | { type: "done"; messageId: string }
  | { type: "error"; error: string };

// ─── Action Proposals ───

export type ActionState = "proposed" | "approved" | "declined" | "executing" | "succeeded" | "failed";

export type ActionPreviewField = {
  field: string;
  oldValue?: string;
  newValue: string;
};

export type ActionProposal = {
  id: string;
  conversationId: string;
  messageId: string;
  toolName: string;
  toolArguments: Record<string, unknown>;
  description: string;
  preview: ActionPreviewField[];
  state: ActionState;
  idempotencyKey: string;
  result?: string;
  resultUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

// ─── Enrichment ───

export type EnrichmentResult = {
  issueId: string;
  suggestedRice?: RiceScore;
  suggestedAssigneeId?: string;
  suggestedOkrId?: string;
  difficulty?: Difficulty;
  similarIssueIds: string[];
  reasoning: string;
};

// ─── Velocity / Overview ───

export type ShippedIssue = {
  issueId: string;
  identifier: string;
  title: string;
  url: string;
  completedAt: string;
  labels: string[];
  category: "bug" | "feature" | "tech-debt" | "papercut" | "other";
};

export type MemberVelocity = {
  memberId: string;
  name: string;
  avatarUrl?: string;
  thisWeek: number;
  lastWeek: number;
  delta: number;
  shipped: ShippedIssue[];
  wipCount: number;
};

export type CategoryBreakdown = {
  category: string;
  thisWeek: number;
  lastWeek: number;
};

export type VelocityResponse = {
  thisWeekTotal: number;
  lastWeekTotal: number;
  delta: number;
  members: MemberVelocity[];
  categories: CategoryBreakdown[];
  weekStart: string;
  lastWeekStart: string;
};

// ─── Team Config ───

export type TrackedMember = {
  name: string;
  linearUserId: string;
  email: string;
  githubUsername?: string;
};

export type TrackedMemberStatus = TrackedMember & {
  memberId?: string;
  avatarUrl?: string;
  wipCount: number;
  currentStatus: "green" | "yellow" | "red";
  topIssue?: { identifier: string; title: string; boardColumn: BoardColumnId };
};

// ─── API Response wrappers ───

export type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};
