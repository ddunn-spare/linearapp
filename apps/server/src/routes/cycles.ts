import type { FastifyInstance } from "fastify";
import type { StateDb } from "../db";
import type { Cycle } from "@linearapp/shared";

function buildCycleDetail(cycle: Cycle, db: StateDb) {
  const issues = db.getIssuesByCycle(cycle.id);
  const completed = issues.filter(i => i.snapshot.boardColumn === "done").length;
  const inProgress = issues.filter(i => i.snapshot.boardColumn === "in_progress" || i.snapshot.boardColumn === "in_review").length;
  const todo = issues.length - completed - inProgress;

  const now = new Date();
  const start = new Date(cycle.startsAt);
  const end = new Date(cycle.endsAt);
  const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  const elapsedDays = Math.max(0, Math.ceil((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, totalDays - elapsedDays);

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

  return {
    ...cycle,
    totalIssues: issues.length,
    completed,
    inProgress,
    todo,
    totalDays,
    elapsedDays,
    daysRemaining,
    members: Array.from(memberMap.entries()).map(([memberId, stats]) => ({ memberId, ...stats })),
  };
}

export function registerCycleRoutes(app: FastifyInstance, db: StateDb, trackedLinearIds: Set<string>) {
  app.get("/api/cycles", async () => {
    const cycles = db.getAllCycles();
    return { ok: true, data: cycles };
  });

  app.get("/api/cycles/active", async () => {
    const cycle = db.getActiveCycle();
    if (!cycle) return { ok: false, error: "No active cycle" };
    return { ok: true, data: buildCycleDetail(cycle, db) };
  });

  app.get("/api/cycles/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const cycle = db.getCycleById(id);
    if (!cycle) return reply.status(404).send({ ok: false, error: "Cycle not found" });
    return { ok: true, data: buildCycleDetail(cycle, db) };
  });

  app.get("/api/cycles/:id/members", async (request, reply) => {
    const { id } = request.params as { id: string };
    const cycle = db.getCycleById(id);
    if (!cycle) return reply.status(404).send({ ok: false, error: "Cycle not found" });
    const detail = buildCycleDetail(cycle, db);
    return { ok: true, data: { cycle, members: detail.members } };
  });
}
