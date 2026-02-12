import Fastify from "fastify";
import cors from "@fastify/cors";
import type { AppConfig } from "./config";
import type { TrackedMemberStatus, BoardColumnId } from "@linearapp/shared";
import { StateDb } from "./db";
import { LinearGraphqlClient } from "./adapters/linearGraphql";
import { GithubClient } from "./adapters/githubClient";
import { OpenAIClient } from "./adapters/openaiClient";
import { LinearSyncService } from "./services/linearSyncService";
import { GithubSyncService } from "./services/githubSyncService";
import { SyncOrchestrator } from "./services/syncService";
import { ChatService } from "./services/chatService";
import { ActionStateMachine } from "./services/actionStateMachine";
import { ApprovalManager } from "./services/approvalManager";
import { createToolHandlers } from "./tools/index";
import { EnrichmentService } from "./services/enrichmentService";
import { registerHealthRoutes } from "./routes/health";
import { registerSyncRoutes } from "./routes/sync";
import { registerMemberRoutes } from "./routes/members";
import { registerBoardRoutes } from "./routes/board";
import { registerCycleRoutes } from "./routes/cycles";
import { registerOkrRoutes } from "./routes/okrs";
import { registerIssueRoutes } from "./routes/issues";
import { registerDashboardRoutes } from "./routes/dashboard";
import { registerGithubRoutes } from "./routes/github";
import { registerChatRoutes } from "./routes/chat";
import { registerOverviewRoutes } from "./routes/overview";
import fs from "node:fs";

export const createApp = async (cfg: AppConfig) => {
  // Ensure state directory exists
  fs.mkdirSync(cfg.stateRoot, { recursive: true });

  // Initialize core services
  const db = new StateDb(cfg.dbPath);
  const linear = new LinearGraphqlClient(cfg);
  const github = new GithubClient(cfg);
  const openai = new OpenAIClient(cfg);
  const linearSync = new LinearSyncService(cfg, db, linear);
  const githubSync = new GithubSyncService(db, github);
  const syncOrchestrator = new SyncOrchestrator(db, linearSync, githubSync);
  const trackedLinearIds = new Set(cfg.trackedMembers.map(m => m.linearUserId));
  const chatService = new ChatService(db, openai, trackedLinearIds);
  const actionStateMachine = new ActionStateMachine(db);
  const toolHandlers = createToolHandlers(db, trackedLinearIds);
  const approvalManager = new ApprovalManager(actionStateMachine, toolHandlers, db);
  chatService.setApprovalManager(approvalManager);
  const enrichmentService = new EnrichmentService(db, openai);

  // Create Fastify app
  const app = Fastify({ logger: { level: cfg.logLevel } });

  // CORS
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || cfg.corsOrigin === "*") {
        callback(null, true);
        return;
      }
      const allowed = cfg.corsOrigin.split(",").map(s => s.trim());
      const isAllowed = allowed.some(a => origin === a || origin.replace("localhost", "127.0.0.1") === a || origin.replace("127.0.0.1", "localhost") === a);
      callback(null, isAllowed || true); // Allow all for local dev
    },
    credentials: true,
  });

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Unhandled route error");
    const err = error as Error & { statusCode?: number };
    const statusCode = typeof err.statusCode === "number" ? err.statusCode : 500;
    return reply.status(statusCode >= 400 && statusCode <= 599 ? statusCode : 500).send({
      ok: false,
      error: err.message || "Internal server error",
      ...(cfg.exposeErrorDetails ? { stack: err.stack } : {}),
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({ ok: false, error: "Route not found" });
  });

  // Register all routes
  registerHealthRoutes(app, db, linear);
  registerSyncRoutes(app, syncOrchestrator, linear);
  registerMemberRoutes(app, db, trackedLinearIds);
  registerBoardRoutes(app, db, linear, cfg);
  registerCycleRoutes(app, db, trackedLinearIds);
  registerOkrRoutes(app, db);
  registerIssueRoutes(app, db);
  registerDashboardRoutes(app, db, trackedLinearIds);
  registerGithubRoutes(app, db);
  registerChatRoutes(app, db, chatService, approvalManager);
  registerOverviewRoutes(app, db, openai, trackedLinearIds);

  // Team config route — returns tracked members with live status
  app.get("/api/team-config", async () => {
    const wipCounts = db.getWipCountByAssignee();
    const members = db.getMembers();
    const memberByLinearId = new Map(members.map(m => [m.linearUserId, m]));

    const result: TrackedMemberStatus[] = cfg.trackedMembers.map(tm => {
      const dbMember = memberByLinearId.get(tm.linearUserId);
      const wipCount = wipCounts.get(tm.linearUserId) || 0;
      const currentStatus: "green" | "yellow" | "red" = wipCount >= 5 ? "red" : wipCount >= 3 ? "yellow" : "green";

      let topIssue: TrackedMemberStatus["topIssue"] = undefined;
      if (dbMember) {
        const issues = db.getIssuesByAssignee(tm.linearUserId);
        const active = issues.find(i =>
          i.snapshot.boardColumn === "in_progress" || i.snapshot.boardColumn === "in_review"
        );
        if (active) {
          topIssue = {
            identifier: active.snapshot.identifier,
            title: active.snapshot.title,
            boardColumn: active.snapshot.boardColumn as BoardColumnId,
          };
        }
      }

      return {
        ...tm,
        memberId: dbMember?.id,
        avatarUrl: dbMember?.avatarUrl,
        wipCount,
        currentStatus,
        topIssue,
      };
    });

    return { trackedMembers: result };
  });

  // Enrichment route
  app.post("/api/enrich/:issueId", async (request, reply) => {
    const { issueId } = request.params as { issueId: string };
    const issue = db.getIssueById(issueId);
    if (!issue) return reply.status(404).send({ ok: false, error: "Issue not found" });
    const enrichment = await enrichmentService.enrichIssue(issue);
    return { ok: true, enrichment };
  });

  app.post("/api/enrich/batch", async (request, reply) => {
    const body = request.body as { issueIds?: string[] };
    if (!body?.issueIds?.length) return reply.status(400).send({ ok: false, error: "issueIds required" });
    const enrichments = await enrichmentService.enrichBatch(body.issueIds);
    return { ok: true, enrichments };
  });

  // Background sync setup
  let linearSyncRunning = false;
  let githubSyncRunning = false;

  const linearInterval = setInterval(async () => {
    if (!linear.hasKey || linearSyncRunning) return;
    linearSyncRunning = true;
    try { await syncOrchestrator.syncAll("background-linear-sync"); }
    catch (e) { app.log.error({ err: e }, "Background Linear sync failed"); }
    finally { linearSyncRunning = false; }
  }, cfg.backgroundRefreshMs);

  const githubInterval = setInterval(async () => {
    if (!github.isConfigured || githubSyncRunning) return;
    githubSyncRunning = true;
    try { await githubSync.sync(); }
    catch (e) { app.log.error({ err: e }, "Background GitHub sync failed"); }
    finally { githubSyncRunning = false; }
  }, 5 * 60 * 1000); // GitHub every 5 min

  // Initial sync on startup
  syncOrchestrator.syncAll("startup-sync").catch(e => {
    app.log.warn({ err: e }, "Initial sync failed — app still available");
  });

  // Cleanup on close
  app.addHook("onClose", async () => {
    clearInterval(linearInterval);
    clearInterval(githubInterval);
    db.close();
  });

  return app;
};
