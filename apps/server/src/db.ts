import Database from "better-sqlite3";
import type {
  ActionCategory,
  ActionProposal,
  ActionState,
  BoardColumnId,
  ChatConversation,
  ChatMessage,
  Cycle,
  IssueEnrichment,
  IssueSnapshot,
  IssueView,
  IssueWithState,
  IssueDraft,
  OkrDoc,
  PrReview,
  PullRequest,
  RiceScore,
  Skill,
  SkillMatch,
  SyncStatus,
  TeamMember,
  WipLimit,
} from "@linearapp/shared";

const schemaSql = `
CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  linear_user_id TEXT,
  github_username TEXT,
  name TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  role TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
  issue_id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  status TEXT NOT NULL,
  status_type TEXT NOT NULL,
  board_column TEXT NOT NULL DEFAULT 'backlog',
  assignee_id TEXT,
  assignee_name TEXT,
  estimate INTEGER,
  labels_json TEXT NOT NULL DEFAULT '[]',
  priority INTEGER,
  project_id TEXT,
  project_name TEXT,
  team_id TEXT NOT NULL,
  team_key TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  cycle_id TEXT,
  cycle_name TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  number INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  completed_scope_count INTEGER NOT NULL DEFAULT 0,
  total_scope_count INTEGER NOT NULL DEFAULT 0,
  progress REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS okrs (
  okr_id TEXT PRIMARY KEY,
  quarter TEXT NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  objective TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  issue_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS key_results (
  id TEXT PRIMARY KEY,
  okr_id TEXT NOT NULL REFERENCES okrs(okr_id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  target_value REAL NOT NULL DEFAULT 100,
  current_value REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '%',
  progress REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pull_requests (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  state TEXT NOT NULL,
  author_login TEXT NOT NULL,
  author_avatar_url TEXT,
  repo TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  linked_issue_id TEXT,
  linked_issue_identifier TEXT,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  merged_at TEXT
);

CREATE TABLE IF NOT EXISTS pr_reviews (
  id TEXT PRIMARY KEY,
  pr_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  reviewer_login TEXT NOT NULL,
  state TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issue_enrichments (
  issue_id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  provider TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_successful_sync TEXT,
  last_attempted_sync TEXT,
  running_jobs_json TEXT NOT NULL DEFAULT '[]',
  mode TEXT NOT NULL DEFAULT 'none',
  errors_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS wip_limits (
  column_id TEXT PRIMARY KEY,
  wip_limit INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS issue_drafts (
  issue_id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_proposals (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_arguments_json TEXT NOT NULL,
  description TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'proposed',
  idempotency_key TEXT NOT NULL UNIQUE,
  result TEXT,
  result_url TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  tags_json TEXT NOT NULL DEFAULT '[]',
  template TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  linear_customer_id TEXT UNIQUE,
  name TEXT NOT NULL,
  tier TEXT,
  tier_id TEXT,
  status TEXT,
  contract_value REAL,
  revenue REAL,
  domains_json TEXT NOT NULL DEFAULT '[]',
  weight REAL NOT NULL DEFAULT 1.0,
  notes TEXT,
  logo_url TEXT,
  owner_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  state TEXT NOT NULL DEFAULT 'planned',
  progress REAL NOT NULL DEFAULT 0,
  start_date TEXT,
  target_date TEXT,
  url TEXT,
  issue_count INTEGER NOT NULL DEFAULT 0,
  completed_issue_count INTEGER NOT NULL DEFAULT 0,
  member_ids_json TEXT NOT NULL DEFAULT '[]',
  synced_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const defaultWipLimits: WipLimit[] = [
  { columnId: "backlog", limit: 50 },
  { columnId: "todo", limit: 10 },
  { columnId: "in_progress", limit: 5 },
  { columnId: "in_review", limit: 3 },
  { columnId: "done", limit: 100 },
];

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export class StateDb {
  private db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(schemaSql);

    this.db
      .prepare(`INSERT OR IGNORE INTO sync_state (id, running_jobs_json, mode, errors_json) VALUES (1, '[]', 'none', '[]')`)
      .run();

    for (const wl of defaultWipLimits) {
      this.db
        .prepare(`INSERT OR IGNORE INTO wip_limits (column_id, wip_limit) VALUES (?, ?)`)
        .run(wl.columnId, wl.limit);
    }

    // Migration: add matched_skills_json column to chat_messages
    try { this.db.exec(`ALTER TABLE chat_messages ADD COLUMN matched_skills_json TEXT`); } catch { /* column already exists */ }

    // Migration: add category column to action_proposals
    try { this.db.exec(`ALTER TABLE action_proposals ADD COLUMN category TEXT NOT NULL DEFAULT 'internal'`); } catch { /* column already exists */ }
  }

  close() {
    this.db.close();
  }

  getRawDb() {
    return this.db;
  }

  // ─── Team Members ───

  upsertMember(member: TeamMember) {
    this.db.prepare(`
      INSERT INTO team_members (id, linear_user_id, github_username, name, email, avatar_url, role, is_active, created_at, updated_at)
      VALUES (@id, @linearUserId, @githubUsername, @name, @email, @avatarUrl, @role, @isActive, @createdAt, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        linear_user_id = excluded.linear_user_id,
        github_username = excluded.github_username,
        name = excluded.name,
        email = excluded.email,
        avatar_url = excluded.avatar_url,
        role = excluded.role,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at
    `).run({
      id: member.id,
      linearUserId: member.linearUserId ?? null,
      githubUsername: member.githubUsername ?? null,
      name: member.name,
      email: member.email ?? null,
      avatarUrl: member.avatarUrl ?? null,
      role: member.role ?? null,
      isActive: member.isActive ? 1 : 0,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
    });
  }

  getMembers(): TeamMember[] {
    const rows = this.db.prepare(`SELECT * FROM team_members WHERE is_active = 1 ORDER BY name`).all() as any[];
    return rows.map(r => ({
      id: r.id,
      linearUserId: r.linear_user_id ?? undefined,
      githubUsername: r.github_username ?? undefined,
      name: r.name,
      email: r.email ?? undefined,
      avatarUrl: r.avatar_url ?? undefined,
      role: r.role ?? undefined,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  getMemberById(id: string): TeamMember | undefined {
    const r = this.db.prepare(`SELECT * FROM team_members WHERE id = ?`).get(id) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      linearUserId: r.linear_user_id ?? undefined,
      githubUsername: r.github_username ?? undefined,
      name: r.name,
      email: r.email ?? undefined,
      avatarUrl: r.avatar_url ?? undefined,
      role: r.role ?? undefined,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  deleteMember(id: string) {
    this.db.prepare(`UPDATE team_members SET is_active = 0, updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  }

  // ─── Issues ───

  upsertIssues(snapshots: IssueSnapshot[]) {
    if (!snapshots.length) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO issues (issue_id, identifier, title, description, url, status, status_type, board_column,
        assignee_id, assignee_name, estimate, labels_json, priority, project_id, project_name,
        team_id, team_key, updated_at, completed_at, created_at, cycle_id, cycle_name, synced_at)
      VALUES (@issueId, @identifier, @title, @description, @url, @status, @statusType, @boardColumn,
        @assigneeId, @assigneeName, @estimate, @labelsJson, @priority, @projectId, @projectName,
        @teamId, @teamKey, @updatedAt, @completedAt, @createdAt, @cycleId, @cycleName, @syncedAt)
      ON CONFLICT(issue_id) DO UPDATE SET
        identifier=excluded.identifier, title=excluded.title, description=excluded.description,
        url=excluded.url, status=excluded.status, status_type=excluded.status_type,
        board_column=excluded.board_column, assignee_id=excluded.assignee_id,
        assignee_name=excluded.assignee_name, estimate=excluded.estimate,
        labels_json=excluded.labels_json, priority=excluded.priority,
        project_id=excluded.project_id, project_name=excluded.project_name,
        team_id=excluded.team_id, team_key=excluded.team_key,
        updated_at=excluded.updated_at, completed_at=excluded.completed_at,
        created_at=excluded.created_at, cycle_id=excluded.cycle_id,
        cycle_name=excluded.cycle_name, synced_at=excluded.synced_at
    `);

    const tx = this.db.transaction((items: IssueSnapshot[]) => {
      for (const s of items) {
        stmt.run({
          issueId: s.issueId, identifier: s.identifier, title: s.title,
          description: s.description ?? null, url: s.url, status: s.status,
          statusType: s.statusType, boardColumn: s.boardColumn,
          assigneeId: s.assigneeId ?? null, assigneeName: s.assigneeName ?? null,
          estimate: s.estimate ?? null, labelsJson: JSON.stringify(s.labels),
          priority: s.priority ?? null, projectId: s.projectId ?? null,
          projectName: s.projectName ?? null, teamId: s.teamId, teamKey: s.teamKey,
          updatedAt: s.updatedAt, completedAt: s.completedAt ?? null,
          createdAt: s.createdAt, cycleId: s.cycleId ?? null,
          cycleName: s.cycleName ?? null, syncedAt: now,
        });
      }
    });
    tx(snapshots);
  }

  private toSnapshot(r: any): IssueSnapshot {
    return {
      issueId: r.issue_id, identifier: r.identifier, title: r.title,
      description: r.description ?? undefined, url: r.url, status: r.status,
      statusType: r.status_type, boardColumn: r.board_column as BoardColumnId,
      assigneeId: r.assignee_id ?? undefined, assigneeName: r.assignee_name ?? undefined,
      estimate: r.estimate ?? undefined, labels: safeJson(r.labels_json, []),
      priority: r.priority ?? undefined, projectId: r.project_id ?? undefined,
      projectName: r.project_name ?? undefined, teamId: r.team_id, teamKey: r.team_key,
      updatedAt: r.updated_at, completedAt: r.completed_at ?? undefined,
      createdAt: r.created_at, cycleId: r.cycle_id ?? undefined,
      cycleName: r.cycle_name ?? undefined,
    };
  }

  private toIssueWithState(r: any): IssueWithState {
    const snapshot = this.toSnapshot(r);
    const enrichment = r.enrichment_json ? safeJson<IssueEnrichment | undefined>(r.enrichment_json, undefined) : undefined;
    const draft = r.draft_json ? safeJson<IssueDraft | undefined>(r.draft_json, undefined) : undefined;
    const prs = this.getPrsForIssue(snapshot.issueId);
    return { snapshot, enrichment, draft, hasPendingChanges: Boolean(draft), pullRequests: prs.length ? prs : undefined };
  }

  getIssuesForView(view: IssueView): IssueWithState[] {
    const where: Record<IssueView, string> = {
      triage: "status_type IN ('triage','backlog','unstarted') AND status_type NOT IN ('completed','canceled')",
      backlog: "board_column IN ('backlog','todo')",
      inprogress: "board_column IN ('in_progress','in_review')",
      done: "board_column = 'done'",
    };
    const rows = this.db.prepare(`
      SELECT i.*, e.data_json AS enrichment_json, d.data_json AS draft_json
      FROM issues i
      LEFT JOIN issue_enrichments e ON i.issue_id = e.issue_id
      LEFT JOIN issue_drafts d ON i.issue_id = d.issue_id
      WHERE ${where[view]}
      ORDER BY datetime(i.updated_at) DESC
    `).all() as any[];
    return rows.map(r => this.toIssueWithState(r));
  }

  getAllIssues(): IssueWithState[] {
    const rows = this.db.prepare(`
      SELECT i.*, e.data_json AS enrichment_json, d.data_json AS draft_json
      FROM issues i
      LEFT JOIN issue_enrichments e ON i.issue_id = e.issue_id
      LEFT JOIN issue_drafts d ON i.issue_id = d.issue_id
      ORDER BY datetime(i.updated_at) DESC
    `).all() as any[];
    return rows.map(r => this.toIssueWithState(r));
  }

  getIssueById(issueId: string): IssueWithState | undefined {
    const r = this.db.prepare(`
      SELECT i.*, e.data_json AS enrichment_json, d.data_json AS draft_json
      FROM issues i
      LEFT JOIN issue_enrichments e ON i.issue_id = e.issue_id
      LEFT JOIN issue_drafts d ON i.issue_id = d.issue_id
      WHERE i.issue_id = ?
    `).get(issueId) as any;
    return r ? this.toIssueWithState(r) : undefined;
  }

  getIssuesByColumn(column: BoardColumnId): IssueWithState[] {
    const rows = this.db.prepare(`
      SELECT i.*, e.data_json AS enrichment_json, d.data_json AS draft_json
      FROM issues i
      LEFT JOIN issue_enrichments e ON i.issue_id = e.issue_id
      LEFT JOIN issue_drafts d ON i.issue_id = d.issue_id
      WHERE i.board_column = ?
      ORDER BY i.priority ASC, datetime(i.updated_at) DESC
    `).all(column) as any[];
    return rows.map(r => this.toIssueWithState(r));
  }

  getIssuesByAssignee(assigneeId: string): IssueWithState[] {
    const rows = this.db.prepare(`
      SELECT i.*, e.data_json AS enrichment_json, d.data_json AS draft_json
      FROM issues i
      LEFT JOIN issue_enrichments e ON i.issue_id = e.issue_id
      LEFT JOIN issue_drafts d ON i.issue_id = d.issue_id
      WHERE i.assignee_id = ?
      ORDER BY datetime(i.updated_at) DESC
    `).all(assigneeId) as any[];
    return rows.map(r => this.toIssueWithState(r));
  }

  getIssuesByCycle(cycleId: string): IssueWithState[] {
    const rows = this.db.prepare(`
      SELECT i.*, e.data_json AS enrichment_json, d.data_json AS draft_json
      FROM issues i
      LEFT JOIN issue_enrichments e ON i.issue_id = e.issue_id
      LEFT JOIN issue_drafts d ON i.issue_id = d.issue_id
      WHERE i.cycle_id = ?
      ORDER BY datetime(i.updated_at) DESC
    `).all(cycleId) as any[];
    return rows.map(r => this.toIssueWithState(r));
  }

  updateIssueColumn(issueId: string, column: BoardColumnId) {
    this.db.prepare(`UPDATE issues SET board_column = ?, updated_at = ? WHERE issue_id = ?`)
      .run(column, new Date().toISOString(), issueId);
  }

  searchIssues(query: string, limit = 20): IssueWithState[] {
    const rows = this.db.prepare(`
      SELECT i.*, e.data_json AS enrichment_json, d.data_json AS draft_json
      FROM issues i
      LEFT JOIN issue_enrichments e ON i.issue_id = e.issue_id
      LEFT JOIN issue_drafts d ON i.issue_id = d.issue_id
      WHERE i.title LIKE ? OR i.identifier LIKE ? OR i.description LIKE ?
      ORDER BY datetime(i.updated_at) DESC
      LIMIT ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, limit) as any[];
    return rows.map(r => this.toIssueWithState(r));
  }

  updateIssueRice(issueId: string, rice: RiceScore) {
    const existing = this.db.prepare(`SELECT data_json FROM issue_enrichments WHERE issue_id = ?`).get(issueId) as any;
    if (existing) {
      const data = safeJson<any>(existing.data_json, {});
      data.rice = rice;
      this.db.prepare(`UPDATE issue_enrichments SET data_json = ?, generated_at = ? WHERE issue_id = ?`)
        .run(JSON.stringify(data), new Date().toISOString(), issueId);
    } else {
      const enrichment: IssueEnrichment = {
        issueId, rice, similarIssueIds: [], reasoning: "", generatedAt: new Date().toISOString(), provider: "heuristic",
      };
      this.db.prepare(`INSERT INTO issue_enrichments (issue_id, data_json, generated_at, provider) VALUES (?,?,?,?)`)
        .run(issueId, JSON.stringify(enrichment), enrichment.generatedAt, enrichment.provider);
    }
  }

  // ─── Enrichments ───

  saveEnrichment(enrichment: IssueEnrichment) {
    this.db.prepare(`
      INSERT INTO issue_enrichments (issue_id, data_json, generated_at, provider)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET data_json=excluded.data_json, generated_at=excluded.generated_at, provider=excluded.provider
    `).run(enrichment.issueId, JSON.stringify(enrichment), enrichment.generatedAt, enrichment.provider);
  }

  getEnrichment(issueId: string): IssueEnrichment | undefined {
    const r = this.db.prepare(`SELECT data_json FROM issue_enrichments WHERE issue_id = ?`).get(issueId) as any;
    return r ? safeJson<IssueEnrichment | undefined>(r.data_json, undefined) : undefined;
  }

  // ─── Drafts ───

  saveDraft(draft: IssueDraft) {
    this.db.prepare(`
      INSERT INTO issue_drafts (issue_id, data_json, updated_at) VALUES (?,?,?)
      ON CONFLICT(issue_id) DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at
    `).run(draft.issueId, JSON.stringify(draft), draft.updatedAt);
  }

  getDraft(issueId: string): IssueDraft | undefined {
    const r = this.db.prepare(`SELECT data_json FROM issue_drafts WHERE issue_id = ?`).get(issueId) as any;
    return r ? safeJson<IssueDraft | undefined>(r.data_json, undefined) : undefined;
  }

  deleteDraft(issueId: string) {
    this.db.prepare(`DELETE FROM issue_drafts WHERE issue_id = ?`).run(issueId);
  }

  // ─── Cycles ───

  upsertCycles(cycles: Cycle[]) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO cycles (id, name, number, starts_at, ends_at, completed_scope_count, total_scope_count, progress, is_active, synced_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, number=excluded.number, starts_at=excluded.starts_at,
        ends_at=excluded.ends_at, completed_scope_count=excluded.completed_scope_count,
        total_scope_count=excluded.total_scope_count, progress=excluded.progress,
        is_active=excluded.is_active, synced_at=excluded.synced_at
    `);
    const tx = this.db.transaction((items: Cycle[]) => {
      for (const c of items) {
        stmt.run(c.id, c.name, c.number, c.startsAt, c.endsAt, c.completedScopeCount, c.totalScopeCount, c.progress, c.isActive ? 1 : 0, now);
      }
    });
    tx(cycles);
  }

  private toCycle(r: any): Cycle {
    return {
      id: r.id, name: r.name, number: r.number, startsAt: r.starts_at,
      endsAt: r.ends_at, completedScopeCount: r.completed_scope_count,
      totalScopeCount: r.total_scope_count, progress: r.progress,
      isActive: Boolean(r.is_active),
    };
  }

  getActiveCycle(): Cycle | undefined {
    const r = this.db.prepare(`SELECT * FROM cycles WHERE is_active = 1 LIMIT 1`).get() as any;
    return r ? this.toCycle(r) : undefined;
  }

  getCycleById(id: string): Cycle | undefined {
    const r = this.db.prepare(`SELECT * FROM cycles WHERE id = ?`).get(id) as any;
    return r ? this.toCycle(r) : undefined;
  }

  getAllCycles(): Cycle[] {
    return (this.db.prepare(`SELECT * FROM cycles ORDER BY number DESC`).all() as any[]).map(r => this.toCycle(r));
  }

  // ─── OKRs ───

  upsertOkr(okr: OkrDoc) {
    this.db.prepare(`
      INSERT INTO okrs (okr_id, quarter, owner, status, objective, progress, issue_count, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(okr_id) DO UPDATE SET
        quarter=excluded.quarter, owner=excluded.owner, status=excluded.status,
        objective=excluded.objective, progress=excluded.progress, issue_count=excluded.issue_count,
        updated_at=excluded.updated_at
    `).run(okr.okrId, okr.quarter, okr.owner, okr.status, okr.objective, okr.progress, okr.issueCount, okr.createdAt, okr.updatedAt);

    this.db.prepare(`DELETE FROM key_results WHERE okr_id = ?`).run(okr.okrId);
    const krStmt = this.db.prepare(`
      INSERT INTO key_results (id, okr_id, description, target_value, current_value, unit, progress)
      VALUES (?,?,?,?,?,?,?)
    `);
    for (const kr of okr.keyResults) {
      krStmt.run(kr.id, kr.okrId, kr.description, kr.targetValue, kr.currentValue, kr.unit, kr.progress);
    }
  }

  getOkrs(): OkrDoc[] {
    const okrs = this.db.prepare(`SELECT * FROM okrs ORDER BY quarter DESC, objective`).all() as any[];
    return okrs.map(o => {
      const krs = (this.db.prepare(`SELECT * FROM key_results WHERE okr_id = ?`).all(o.okr_id) as any[]).map(kr => ({
        id: kr.id, okrId: kr.okr_id, description: kr.description,
        targetValue: kr.target_value, currentValue: kr.current_value,
        unit: kr.unit, progress: kr.progress,
      }));
      return {
        okrId: o.okr_id, quarter: o.quarter, owner: o.owner, status: o.status,
        objective: o.objective, keyResults: krs, progress: o.progress,
        issueCount: o.issue_count, createdAt: o.created_at, updatedAt: o.updated_at,
      };
    });
  }

  getOkrById(okrId: string): OkrDoc | undefined {
    const o = this.db.prepare(`SELECT * FROM okrs WHERE okr_id = ?`).get(okrId) as any;
    if (!o) return undefined;
    const krs = (this.db.prepare(`SELECT * FROM key_results WHERE okr_id = ?`).all(okrId) as any[]).map(kr => ({
      id: kr.id, okrId: kr.okr_id, description: kr.description,
      targetValue: kr.target_value, currentValue: kr.current_value,
      unit: kr.unit, progress: kr.progress,
    }));
    return {
      okrId: o.okr_id, quarter: o.quarter, owner: o.owner, status: o.status,
      objective: o.objective, keyResults: krs, progress: o.progress,
      issueCount: o.issue_count, createdAt: o.created_at, updatedAt: o.updated_at,
    };
  }

  deleteOkr(okrId: string) {
    this.db.prepare(`DELETE FROM okrs WHERE okr_id = ?`).run(okrId);
  }

  updateKeyResultProgress(krId: string, currentValue: number) {
    const kr = this.db.prepare(`SELECT * FROM key_results WHERE id = ?`).get(krId) as any;
    if (!kr) return;
    const progress = kr.target_value > 0 ? Math.min(100, (currentValue / kr.target_value) * 100) : 0;
    this.db.prepare(`UPDATE key_results SET current_value = ?, progress = ? WHERE id = ?`).run(currentValue, progress, krId);

    const allKrs = this.db.prepare(`SELECT progress FROM key_results WHERE okr_id = ?`).all(kr.okr_id) as any[];
    const avgProgress = allKrs.length > 0 ? allKrs.reduce((s: number, k: any) => s + k.progress, 0) / allKrs.length : 0;
    this.db.prepare(`UPDATE okrs SET progress = ?, updated_at = ? WHERE okr_id = ?`)
      .run(avgProgress, new Date().toISOString(), kr.okr_id);
  }

  // ─── Pull Requests ───

  upsertPullRequests(prs: PullRequest[]) {
    const prStmt = this.db.prepare(`
      INSERT INTO pull_requests (id, number, title, url, state, author_login, author_avatar_url, repo, branch_name,
        linked_issue_id, linked_issue_identifier, additions, deletions, review_status, created_at, updated_at, merged_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, url=excluded.url, state=excluded.state,
        author_login=excluded.author_login, author_avatar_url=excluded.author_avatar_url,
        linked_issue_id=excluded.linked_issue_id, linked_issue_identifier=excluded.linked_issue_identifier,
        additions=excluded.additions, deletions=excluded.deletions,
        review_status=excluded.review_status, updated_at=excluded.updated_at, merged_at=excluded.merged_at
    `);
    const rvStmt = this.db.prepare(`
      INSERT INTO pr_reviews (id, pr_id, reviewer_login, state, submitted_at)
      VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state, submitted_at=excluded.submitted_at
    `);

    const tx = this.db.transaction((items: PullRequest[]) => {
      for (const pr of items) {
        prStmt.run(pr.id, pr.number, pr.title, pr.url, pr.state, pr.authorLogin,
          pr.authorAvatarUrl ?? null, pr.repo, pr.branchName, pr.linkedIssueId ?? null,
          pr.linkedIssueIdentifier ?? null, pr.additions, pr.deletions,
          pr.reviewStatus, pr.createdAt, pr.updatedAt, pr.mergedAt ?? null);
        for (const rv of pr.reviews) {
          rvStmt.run(rv.id, rv.prId, rv.reviewerLogin, rv.state, rv.submittedAt);
        }
      }
    });
    tx(prs);
  }

  getPrsForIssue(issueId: string): PullRequest[] {
    const rows = this.db.prepare(`SELECT * FROM pull_requests WHERE linked_issue_id = ? ORDER BY created_at DESC`).all(issueId) as any[];
    return rows.map(r => this.toPullRequest(r));
  }

  getPrsByAuthor(authorLogin: string): PullRequest[] {
    const rows = this.db.prepare(`SELECT * FROM pull_requests WHERE author_login = ? ORDER BY created_at DESC`).all(authorLogin) as any[];
    return rows.map(r => this.toPullRequest(r));
  }

  getReviewsByReviewer(reviewerLogin: string): PrReview[] {
    return (this.db.prepare(`SELECT * FROM pr_reviews WHERE reviewer_login = ? ORDER BY submitted_at DESC`).all(reviewerLogin) as any[]).map(r => ({
      id: r.id, prId: r.pr_id, reviewerLogin: r.reviewer_login, state: r.state, submittedAt: r.submitted_at,
    }));
  }

  getAllPrs(filters?: { state?: string; repo?: string; authorLogin?: string }): PullRequest[] {
    let sql = `SELECT * FROM pull_requests WHERE 1=1`;
    const params: any[] = [];
    if (filters?.state) { sql += ` AND state = ?`; params.push(filters.state); }
    if (filters?.repo) { sql += ` AND repo = ?`; params.push(filters.repo); }
    if (filters?.authorLogin) { sql += ` AND author_login = ?`; params.push(filters.authorLogin); }
    sql += ` ORDER BY created_at DESC`;
    return (this.db.prepare(sql).all(...params) as any[]).map(r => this.toPullRequest(r));
  }

  private toPullRequest(r: any): PullRequest {
    const reviews = (this.db.prepare(`SELECT * FROM pr_reviews WHERE pr_id = ?`).all(r.id) as any[]).map(rv => ({
      id: rv.id, prId: rv.pr_id, reviewerLogin: rv.reviewer_login, state: rv.state, submittedAt: rv.submitted_at,
    }));
    return {
      id: r.id, number: r.number, title: r.title, url: r.url, state: r.state,
      authorLogin: r.author_login, authorAvatarUrl: r.author_avatar_url ?? undefined,
      repo: r.repo, branchName: r.branch_name,
      linkedIssueId: r.linked_issue_id ?? undefined,
      linkedIssueIdentifier: r.linked_issue_identifier ?? undefined,
      additions: r.additions, deletions: r.deletions,
      reviewStatus: r.review_status, reviews,
      createdAt: r.created_at, updatedAt: r.updated_at, mergedAt: r.merged_at ?? undefined,
    };
  }

  // ─── Chat ───

  createConversation(id: string, title: string): ChatConversation {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO chat_conversations (id, title, created_at, updated_at) VALUES (?,?,?,?)`)
      .run(id, title, now, now);
    return { id, title, createdAt: now, updatedAt: now };
  }

  getConversations(): ChatConversation[] {
    return (this.db.prepare(`SELECT * FROM chat_conversations ORDER BY updated_at DESC`).all() as any[]).map(r => ({
      id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  }

  addMessage(msg: ChatMessage) {
    this.db.prepare(`INSERT INTO chat_messages (id, conversation_id, role, content, tool_calls_json, matched_skills_json, created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(msg.id, msg.conversationId, msg.role, msg.content, msg.toolCalls ? JSON.stringify(msg.toolCalls) : null, msg.matchedSkills ? JSON.stringify(msg.matchedSkills) : null, msg.createdAt);
    this.db.prepare(`UPDATE chat_conversations SET updated_at = ? WHERE id = ?`)
      .run(msg.createdAt, msg.conversationId);
  }

  getMessages(conversationId: string): ChatMessage[] {
    return (this.db.prepare(`SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at`).all(conversationId) as any[]).map(r => ({
      id: r.id, conversationId: r.conversation_id, role: r.role, content: r.content,
      toolCalls: r.tool_calls_json ? safeJson(r.tool_calls_json, undefined) : undefined,
      matchedSkills: r.matched_skills_json ? safeJson<SkillMatch[] | undefined>(r.matched_skills_json, undefined) : undefined,
      createdAt: r.created_at,
    }));
  }

  deleteConversation(conversationId: string) {
    this.db.prepare(`DELETE FROM chat_conversations WHERE id = ?`).run(conversationId);
  }

  // ─── Action Proposals ───

  createActionProposal(proposal: ActionProposal): void {
    this.db.prepare(`
      INSERT INTO action_proposals (id, conversation_id, message_id, tool_name, tool_arguments_json, description, preview_json, state, category, idempotency_key, result, result_url, error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      proposal.id,
      proposal.conversationId,
      proposal.messageId,
      proposal.toolName,
      JSON.stringify(proposal.toolArguments),
      proposal.description,
      JSON.stringify(proposal.preview),
      proposal.state,
      proposal.category ?? "internal",
      proposal.idempotencyKey,
      proposal.result ?? null,
      proposal.resultUrl ?? null,
      proposal.error ?? null,
      proposal.createdAt,
      proposal.updatedAt,
    );
  }

  updateActionState(id: string, state: ActionState, updates?: { result?: string; resultUrl?: string; error?: string }): void {
    this.db.prepare(`
      UPDATE action_proposals SET state = ?, result = COALESCE(?, result), result_url = COALESCE(?, result_url), error = COALESCE(?, error), updated_at = ? WHERE id = ?
    `).run(
      state,
      updates?.result ?? null,
      updates?.resultUrl ?? null,
      updates?.error ?? null,
      new Date().toISOString(),
      id,
    );
  }

  getActionProposal(id: string): ActionProposal | null {
    const r = this.db.prepare(`SELECT * FROM action_proposals WHERE id = ?`).get(id) as any;
    return r ? this.toActionProposal(r) : null;
  }

  getActionProposalsByMessage(messageId: string): ActionProposal[] {
    const rows = this.db.prepare(`SELECT * FROM action_proposals WHERE message_id = ? ORDER BY created_at`).all(messageId) as any[];
    return rows.map(r => this.toActionProposal(r));
  }

  getActionProposalsByConversation(conversationId: string): ActionProposal[] {
    const rows = this.db.prepare(`SELECT * FROM action_proposals WHERE conversation_id = ? ORDER BY created_at`).all(conversationId) as any[];
    return rows.map(r => this.toActionProposal(r));
  }

  getActionProposalByIdempotencyKey(key: string): ActionProposal | null {
    const r = this.db.prepare(`SELECT * FROM action_proposals WHERE idempotency_key = ?`).get(key) as any;
    return r ? this.toActionProposal(r) : null;
  }

  private toActionProposal(r: any): ActionProposal {
    return {
      id: r.id,
      conversationId: r.conversation_id,
      messageId: r.message_id,
      toolName: r.tool_name,
      toolArguments: safeJson<Record<string, unknown>>(r.tool_arguments_json, {}),
      description: r.description,
      preview: safeJson(r.preview_json, []),
      state: r.state as ActionState,
      category: (r.category as ActionCategory) ?? undefined,
      idempotencyKey: r.idempotency_key,
      result: r.result ?? undefined,
      resultUrl: r.result_url ?? undefined,
      error: r.error ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // ─── Skills ───

  createSkill(skill: Skill): void {
    this.db.prepare(`
      INSERT INTO skills (id, name, description, category, tags_json, template, enabled, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(skill.id, skill.name, skill.description, skill.category, JSON.stringify(skill.tags), skill.template, skill.enabled ? 1 : 0, skill.createdAt, skill.updatedAt);
  }

  updateSkill(id: string, updates: Partial<Omit<Skill, "id" | "createdAt">>): void {
    const existing = this.getSkillById(id);
    if (!existing) return;
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE skills SET name=?, description=?, category=?, tags_json=?, template=?, enabled=?, updated_at=? WHERE id=?
    `).run(
      updates.name ?? existing.name,
      updates.description ?? existing.description,
      updates.category ?? existing.category,
      updates.tags ? JSON.stringify(updates.tags) : JSON.stringify(existing.tags),
      updates.template ?? existing.template,
      updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
      updates.updatedAt ?? now,
      id,
    );
  }

  deleteSkill(id: string): void {
    this.db.prepare(`DELETE FROM skills WHERE id = ?`).run(id);
  }

  getSkillById(id: string): Skill | undefined {
    const r = this.db.prepare(`SELECT * FROM skills WHERE id = ?`).get(id) as any;
    return r ? this.toSkill(r) : undefined;
  }

  getSkillByName(name: string): Skill | undefined {
    const r = this.db.prepare(`SELECT * FROM skills WHERE name = ?`).get(name) as any;
    return r ? this.toSkill(r) : undefined;
  }

  getAllSkills(): Skill[] {
    return (this.db.prepare(`SELECT * FROM skills ORDER BY name`).all() as any[]).map(r => this.toSkill(r));
  }

  getEnabledSkills(): Skill[] {
    return (this.db.prepare(`SELECT * FROM skills WHERE enabled = 1 ORDER BY name`).all() as any[]).map(r => this.toSkill(r));
  }

  private toSkill(r: any): Skill {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      tags: safeJson<string[]>(r.tags_json, []),
      template: r.template,
      enabled: Boolean(r.enabled),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // ─── WIP Limits ───

  getWipLimits(): WipLimit[] {
    return (this.db.prepare(`SELECT * FROM wip_limits`).all() as any[]).map(r => ({
      columnId: r.column_id as BoardColumnId, limit: r.wip_limit,
    }));
  }

  setWipLimit(columnId: BoardColumnId, limit: number) {
    this.db.prepare(`INSERT INTO wip_limits (column_id, wip_limit) VALUES (?,?) ON CONFLICT(column_id) DO UPDATE SET wip_limit=excluded.wip_limit`)
      .run(columnId, limit);
  }

  // ─── Sync State ───

  getSyncStatus(): SyncStatus {
    const r = this.db.prepare(`SELECT * FROM sync_state WHERE id = 1`).get() as any;
    return {
      lastSuccessfulSync: r.last_successful_sync ?? undefined,
      lastAttemptedSync: r.last_attempted_sync ?? undefined,
      runningJobs: safeJson(r.running_jobs_json, []),
      mode: r.mode,
      errors: safeJson(r.errors_json, []),
    };
  }

  setSyncStatus(next: SyncStatus) {
    this.db.prepare(`
      UPDATE sync_state SET last_successful_sync=?, last_attempted_sync=?, running_jobs_json=?, mode=?, errors_json=? WHERE id=1
    `).run(next.lastSuccessfulSync ?? null, next.lastAttemptedSync ?? null,
      JSON.stringify(next.runningJobs), next.mode, JSON.stringify(next.errors));
  }

  markJobStart(jobName: string) {
    const current = this.getSyncStatus();
    const runningJobs = current.runningJobs.includes(jobName) ? current.runningJobs : [...current.runningJobs, jobName];
    this.setSyncStatus({ ...current, runningJobs, lastAttemptedSync: new Date().toISOString() });
  }

  markJobEnd(jobName: string, result: { success: boolean; mode?: "api" | "none"; error?: string }) {
    const current = this.getSyncStatus();
    const runningJobs = current.runningJobs.filter(j => j !== jobName);
    const errors = result.error ? [result.error, ...current.errors].slice(0, 10) : result.success ? [] : current.errors;
    this.setSyncStatus({
      ...current, runningJobs, mode: result.mode || current.mode, errors,
      lastSuccessfulSync: result.success ? new Date().toISOString() : current.lastSuccessfulSync,
      lastAttemptedSync: new Date().toISOString(),
    });
  }

  // ─── Aggregate Queries ───

  getWipCountByAssignee(): Map<string, number> {
    const rows = this.db.prepare(`
      SELECT assignee_id, COUNT(*) as cnt FROM issues
      WHERE board_column IN ('in_progress','in_review') AND assignee_id IS NOT NULL
      GROUP BY assignee_id
    `).all() as any[];
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.assignee_id, r.cnt);
    return map;
  }

  getColumnCounts(): Record<BoardColumnId, number> {
    const rows = this.db.prepare(`SELECT board_column, COUNT(*) as cnt FROM issues GROUP BY board_column`).all() as any[];
    const result: Record<string, number> = { backlog: 0, todo: 0, in_progress: 0, in_review: 0, done: 0 };
    for (const r of rows) result[r.board_column] = r.cnt;
    return result as Record<BoardColumnId, number>;
  }

  // ─── Clients ───

  upsertClient(client: {
    linearCustomerId: string;
    name: string;
    tier?: string;
    tierId?: string;
    status?: string;
    revenue?: number;
    domainsJson: string;
    logoUrl?: string;
    ownerName?: string;
    isActive: boolean;
    syncedAt: string;
  }): void {
    this.db.prepare(`
      INSERT INTO clients (linear_customer_id, name, tier, tier_id, status, revenue, domains_json, logo_url, owner_name, is_active, synced_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(linear_customer_id) DO UPDATE SET
        name=excluded.name, tier=excluded.tier, tier_id=excluded.tier_id,
        status=excluded.status, revenue=excluded.revenue,
        domains_json=excluded.domains_json, logo_url=excluded.logo_url,
        owner_name=excluded.owner_name, is_active=excluded.is_active,
        synced_at=excluded.synced_at, updated_at=datetime('now')
    `).run(
      client.linearCustomerId, client.name, client.tier ?? null, client.tierId ?? null,
      client.status ?? null, client.revenue ?? null, client.domainsJson,
      client.logoUrl ?? null, client.ownerName ?? null, client.isActive ? 1 : 0,
      client.syncedAt,
    );
  }

  getClients(filters?: { tier?: string; isActive?: boolean }): ClientRow[] {
    let sql = `SELECT * FROM clients WHERE 1=1`;
    const params: any[] = [];
    if (filters?.tier) { sql += ` AND tier = ?`; params.push(filters.tier); }
    if (filters?.isActive !== undefined) { sql += ` AND is_active = ?`; params.push(filters.isActive ? 1 : 0); }
    sql += ` ORDER BY weight DESC, name ASC`;
    return (this.db.prepare(sql).all(...params) as any[]).map(r => this.toClientRow(r));
  }

  getClientById(id: number): ClientRow | undefined {
    const r = this.db.prepare(`SELECT * FROM clients WHERE id = ?`).get(id) as any;
    return r ? this.toClientRow(r) : undefined;
  }

  getClientByLinearId(linearCustomerId: string): ClientRow | undefined {
    const r = this.db.prepare(`SELECT * FROM clients WHERE linear_customer_id = ?`).get(linearCustomerId) as any;
    return r ? this.toClientRow(r) : undefined;
  }

  updateClientLocal(id: number, updates: { weight?: number; notes?: string; contractValue?: number }): void {
    const parts: string[] = [];
    const params: any[] = [];
    if (updates.weight !== undefined) { parts.push("weight = ?"); params.push(updates.weight); }
    if (updates.notes !== undefined) { parts.push("notes = ?"); params.push(updates.notes); }
    if (updates.contractValue !== undefined) { parts.push("contract_value = ?"); params.push(updates.contractValue); }
    if (parts.length === 0) return;
    parts.push("updated_at = datetime('now')");
    params.push(id);
    this.db.prepare(`UPDATE clients SET ${parts.join(", ")} WHERE id = ?`).run(...params);
  }

  private toClientRow(r: any): ClientRow {
    return {
      id: r.id,
      linearCustomerId: r.linear_customer_id,
      name: r.name,
      tier: r.tier ?? undefined,
      tierId: r.tier_id ?? undefined,
      status: r.status ?? undefined,
      contractValue: r.contract_value ?? undefined,
      revenue: r.revenue ?? undefined,
      domains: safeJson<string[]>(r.domains_json, []),
      weight: r.weight,
      notes: r.notes ?? undefined,
      logoUrl: r.logo_url ?? undefined,
      ownerName: r.owner_name ?? undefined,
      isActive: Boolean(r.is_active),
      syncedAt: r.synced_at ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // ─── Projects ───

  upsertProjects(projects: Array<{
    id: string; name: string; description?: string; state: string;
    progress: number; startDate?: string; targetDate?: string; url?: string;
    issueCount: number; completedIssueCount: number;
    memberIdsJson: string; syncedAt: string;
  }>): void {
    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, description, state, progress, start_date, target_date, url,
        issue_count, completed_issue_count, member_ids_json, synced_at, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, description=excluded.description, state=excluded.state,
        progress=excluded.progress, start_date=excluded.start_date, target_date=excluded.target_date,
        url=excluded.url, issue_count=excluded.issue_count, completed_issue_count=excluded.completed_issue_count,
        member_ids_json=excluded.member_ids_json, synced_at=excluded.synced_at, updated_at=datetime('now')
    `);
    const tx = this.db.transaction((items: typeof projects) => {
      for (const p of items) {
        stmt.run(p.id, p.name, p.description ?? null, p.state, p.progress,
          p.startDate ?? null, p.targetDate ?? null, p.url ?? null,
          p.issueCount, p.completedIssueCount, p.memberIdsJson, p.syncedAt);
      }
    });
    tx(projects);
  }

  getAllProjects(): ProjectRow[] {
    return (this.db.prepare(`SELECT * FROM projects ORDER BY name`).all() as any[]).map(r => this.toProjectRow(r));
  }

  getProjectById(id: string): ProjectRow | undefined {
    const r = this.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as any;
    return r ? this.toProjectRow(r) : undefined;
  }

  getProjectsByState(state: string): ProjectRow[] {
    return (this.db.prepare(`SELECT * FROM projects WHERE state = ? ORDER BY name`).all(state) as any[]).map(r => this.toProjectRow(r));
  }

  private toProjectRow(r: any): ProjectRow {
    return {
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      state: r.state,
      progress: r.progress,
      startDate: r.start_date ?? undefined,
      targetDate: r.target_date ?? undefined,
      url: r.url ?? undefined,
      issueCount: r.issue_count,
      completedIssueCount: r.completed_issue_count,
      memberIds: safeJson<string[]>(r.member_ids_json, []),
      syncedAt: r.synced_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}

// ─── Row Types ───

export type ClientRow = {
  id: number;
  linearCustomerId: string;
  name: string;
  tier?: string;
  tierId?: string;
  status?: string;
  contractValue?: number;
  revenue?: number;
  domains: string[];
  weight: number;
  notes?: string;
  logoUrl?: string;
  ownerName?: string;
  isActive: boolean;
  syncedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectRow = {
  id: string;
  name: string;
  description?: string;
  state: string;
  progress: number;
  startDate?: string;
  targetDate?: string;
  url?: string;
  issueCount: number;
  completedIssueCount: number;
  memberIds: string[];
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
};
