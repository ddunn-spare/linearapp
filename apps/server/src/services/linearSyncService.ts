import type { AppConfig } from "../config";
import type { StateDb } from "../db";
import type { LinearGraphqlClient } from "../adapters/linearGraphql";
import type { Cycle } from "@linearapp/shared";
import { createLogger } from "../lib/logger";

const log = createLogger("LinearSyncService");

export class LinearSyncService {
  constructor(
    private readonly cfg: AppConfig,
    private readonly db: StateDb,
    private readonly linear: LinearGraphqlClient,
  ) {}

  async syncAll(): Promise<void> {
    await this.syncMembers();
    await this.syncIssues();
    await this.syncCycles();
    await this.syncCustomers();
    await this.syncProjects();
  }

  async syncMembers(): Promise<void> {
    if (!this.linear.hasKey) return;
    const users = await this.linear.listUsers(this.cfg.linearTeamKey);
    const now = new Date().toISOString();
    for (const u of users) {
      this.db.upsertMember({
        id: u.id,
        linearUserId: u.id,
        name: u.name,
        email: u.email,
        avatarUrl: u.avatarUrl,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    log.info("Synced members", { count: users.length });
  }

  async syncIssues(): Promise<void> {
    if (!this.linear.hasKey) return;
    const issues = await this.linear.listIssues(this.cfg.linearTeamKey, 500);
    const statusMap = new Map<string, string>();
    const statuses = await this.linear.listStatuses(this.cfg.linearTeamKey);
    for (const s of statuses) statusMap.set(s.id, s.type);

    const toBoardColumn = (statusType: string): string => {
      switch (statusType) {
        case "started": return "in_progress";
        case "completed": return "done";
        case "canceled": return "done";
        default: return "backlog";
      }
    };

    const snapshots = issues.map(i => ({
      issueId: i.id,
      identifier: i.identifier,
      title: i.title,
      description: i.description,
      url: i.url,
      status: i.status,
      statusType: i.statusType,
      boardColumn: toBoardColumn(i.statusType) as any,
      assigneeId: i.assigneeId,
      assigneeName: i.assigneeName,
      estimate: i.estimate,
      labels: i.labels,
      priority: i.priority,
      projectId: i.projectId,
      projectName: i.projectName,
      teamId: i.teamId,
      teamKey: i.teamKey,
      updatedAt: i.updatedAt,
      completedAt: i.completedAt,
      createdAt: i.createdAt,
      cycleId: i.cycleId,
      cycleName: i.cycleName,
    }));
    this.db.upsertIssues(snapshots);
    log.info("Synced issues", { count: snapshots.length });
  }

  async syncCycles(): Promise<void> {
    if (!this.linear.hasKey) return;
    const rawCycles = await this.linear.listCycles(this.cfg.linearTeamKey);
    if (rawCycles.length === 0) {
      log.warn("No cycles returned from Linear — check team key or workspace configuration");
      return;
    }
    const now = new Date();
    const cycles: Cycle[] = rawCycles.map(c => {
      const startsAt = new Date(c.startsAt);
      const endsAt = new Date(c.endsAt);
      // Use end-of-day for endsAt so the cycle stays active on its last day
      endsAt.setHours(23, 59, 59, 999);
      return {
        id: c.id,
        name: c.name,
        number: c.number,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        completedScopeCount: c.completedScopeCount,
        totalScopeCount: c.scopeCount,
        progress: c.progress,
        isActive: startsAt <= now && now <= endsAt,
      };
    });
    const activeCycle = cycles.find(c => c.isActive);
    if (!activeCycle) {
      log.warn("No active cycle found — closest upcoming or most recent may be between cycles", {
        total: cycles.length,
        mostRecent: cycles[0]?.name,
        mostRecentEnd: cycles[0]?.endsAt,
      });
    } else {
      log.info("Active cycle identified", { name: activeCycle.name, number: activeCycle.number, progress: activeCycle.progress });
    }
    this.db.upsertCycles(cycles);
    log.info("Synced cycles", { count: cycles.length, active: activeCycle?.name ?? "none" });
  }

  async syncCustomers(): Promise<void> {
    if (!this.linear.hasKey) return;
    try {
      const customers = await this.linear.listCustomers();
      const now = new Date().toISOString();
      for (const c of customers) {
        this.db.upsertClient({
          linearCustomerId: c.id,
          name: c.name,
          tier: c.tierName,
          tierId: c.tierId,
          status: c.statusName,
          revenue: c.revenue,
          domainsJson: JSON.stringify(c.domains),
          logoUrl: c.logoUrl,
          ownerName: c.ownerName,
          isActive: true,
          syncedAt: now,
        });
      }
      log.info("Synced customers", { count: customers.length });
    } catch {
      log.debug("Customer sync skipped (feature may not be enabled)");
    }
  }

  async syncProjects(): Promise<void> {
    if (!this.linear.hasKey) return;
    try {
      const projects = await this.linear.listProjectsDetailed(this.cfg.linearTeamKey);
      this.db.upsertProjects(projects.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        state: p.state,
        progress: p.progress,
        startDate: p.startDate,
        targetDate: p.targetDate,
        url: p.url,
        issueCount: p.issueCount,
        completedIssueCount: p.completedIssueCount,
        memberIdsJson: JSON.stringify(p.memberIds),
        syncedAt: new Date().toISOString(),
      })));
      log.info("Synced projects", { count: projects.length });
    } catch (e) {
      log.warn("Project sync failed", { error: e instanceof Error ? e.message : "unknown" });
    }
  }
}
