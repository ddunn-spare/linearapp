import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ChatService } from "../services/chatService";
import type { ApprovalManager } from "../services/approvalManager";
import type { StateDb } from "../db";

export function registerChatRoutes(app: FastifyInstance, db: StateDb, chatService: ChatService, approvalManager: ApprovalManager) {
  // List conversations
  app.get("/api/chat/conversations", async () => {
    return { conversations: db.getConversations() };
  });

  // Get messages for a conversation
  app.get("/api/chat/conversations/:id/messages", async (request, _reply) => {
    const { id } = request.params as { id: string };
    const messages = db.getMessages(id);
    return { messages };
  });

  // Delete a conversation
  app.delete("/api/chat/conversations/:id", async (request) => {
    const { id } = request.params as { id: string };
    db.deleteConversation(id);
    return { ok: true };
  });

  // Send message -- SSE streaming
  app.post("/api/chat", async (request, reply) => {
    const schema = z.object({
      conversationId: z.string().min(1),
      message: z.string().min(1),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: parsed.error.message });
    }

    const { conversationId, message } = parsed.data;

    // SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    try {
      for await (const event of chatService.handleMessageStream(conversationId, message)) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Chat failed";
      reply.raw.write(`data: ${JSON.stringify({ type: "error", error: errorMsg })}\n\n`);
    }

    reply.raw.end();
  });

  // Create a new conversation
  app.post("/api/chat/conversations", async (request) => {
    const schema = z.object({ title: z.string().default("New conversation") });
    const parsed = schema.safeParse(request.body || {});
    const title = parsed.success ? parsed.data.title : "New conversation";
    const conversation = db.createConversation(crypto.randomUUID(), title);
    return { ok: true, conversation };
  });

  // ─── Action Approval Endpoints ───

  // Approve and execute a proposed action
  app.post("/api/chat/actions/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await approvalManager.approve(id);
      const executed = await approvalManager.execute(id);
      return { ok: true, proposal: executed };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Approve failed";
      return reply.status(400).send({ ok: false, error: msg });
    }
  });

  // Decline a proposed action
  app.post("/api/chat/actions/:id/decline", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const declined = await approvalManager.decline(id);
      return { ok: true, proposal: declined };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Decline failed";
      return reply.status(400).send({ ok: false, error: msg });
    }
  });

  // Retry a failed action
  app.post("/api/chat/actions/:id/retry", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const retried = await approvalManager.retry(id);
      return { ok: true, proposal: retried };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Retry failed";
      return reply.status(400).send({ ok: false, error: msg });
    }
  });

  // Get all proposals for a conversation (for re-rendering on refresh, INFRA-04)
  app.get("/api/chat/conversations/:id/proposals", async (request) => {
    const { id } = request.params as { id: string };
    const proposals = approvalManager.getProposalsByConversation(id);
    return { proposals };
  });
}
