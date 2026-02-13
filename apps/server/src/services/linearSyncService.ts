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
    const now = new Date();
    const cycles: Cycle[] = rawCycles.map(c => ({
      id: c.id,
      name: c.name,
      number: c.number,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      completedScopeCount: c.completedScopeCount,
      totalScopeCount: c.scopeCount,
      progress: c.progress,
      isActive: new Date(c.startsAt) <= now && now <= new Date(c.endsAt),
    }));
    this.db.upsertCycles(cycles);
    log.info("Synced cycles", { count: cycles.length });
  }

  /**
   * Sync customers from Linear, filtered to only those with EAM-team issues.
   * Customers without any issues linked to the configured team are skipped.
   */
  async syncCustomers(): Promise<void> {
    if (!this.linear.hasKey) return;
    try {
      const customers = await this.linear.listCustomers();
      const teamKey = this.cfg.linearTeamKey;
      const now = new Date().toISOString();
      let synced = 0;
      let skipped = 0;

      for (const c of customers) {
        // Only sync customers that have issues related to our team
        if (!c.teamKeys.includes(teamKey)) {
          skipped++;
          continue;
        }

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
          issueCount: c.issueCount,
          isActive: true,
          syncedAt: now,
        });
        synced++;
      }
      log.info("Synced customers", { total: customers.length, synced, skipped, teamKey });
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
