import type OpenAI from "openai";
import type { ChatMessage, ChatToolCall, ChatStreamEvent, SkillMatch } from "@linearapp/shared";
import type { StateDb } from "../db";
import type { LinearGraphqlClient } from "../adapters/linearGraphql";
import type { AppConfig } from "../config";
import type { OpenAIClient } from "../adapters/openaiClient";
import type { ApprovalManager } from "./approvalManager";
import type { SkillService } from "./skillService";
import { getToolDefinitions, createToolHandlers, isWriteTool, getWriteToolSummariesGrouped, type ToolHandler } from "../tools/index";

const CATEGORY_LABELS: Record<string, string> = {
  linear: "Linear Actions",
  okr: "OKR Actions",
  internal: "Internal Actions",
};

function buildSystemPrompt(skillTemplates?: string[]): string {
  const grouped = getWriteToolSummariesGrouped();
  let writeSection = "";
  if (grouped.size > 0) {
    const sections: string[] = [];
    for (const [category, tools] of grouped) {
      const label = CATEGORY_LABELS[category] || `${category} Actions`;
      sections.push(`${label} (require approval):\n${tools.map(t => `- ${t.description}`).join("\n")}`);
    }
    writeSection = `\n\nYou can also take actions on behalf of the user:\n\n${sections.join("\n\n")}\n\nWhen you want to take an action, use the appropriate tool. The user will see a preview of what will change and can approve or decline. If they decline, acknowledge naturally and move on — do not ask follow-up questions about the declined action. If they approve, the action will execute and you'll see the result.\n\nWhen you retrieve issue details or search results, look for opportunities to suggest linking issues to key results. If an issue's title, description, or labels align with a key result's description, proactively suggest using link_issue_to_kr. Similarly, when issues linked to a key result are completed, suggest using update_key_result to update the progress.`;
  }

  const skillsSection = skillTemplates?.length
    ? `\n\n--- Active Skills ---\n${skillTemplates.join("\n\n")}`
    : "";

  return `You are Team Hub AI, an intelligent assistant for the EAM engineering team. You help manage work using a "Shaped Kanban with OKR Guardrails" methodology.

Your capabilities:
- Search and analyze issues from Linear
- Check team workload and recommend assignments
- Track cycle progress and identify risks
- Evaluate OKR alignment for work items
- Review GitHub PRs and review status
- Calculate RICE scores for prioritization
- Run ad-hoc queries against the team database${writeSection}

Key principles you follow:
- Flow over utilization — minimize context switching
- WIP limits matter — never overload team members (5 max in-progress)
- Every piece of work should align to an OKR when possible
- Use RICE scoring to prioritize objectively
- Make work visible — surface blockers and risks proactively

When answering questions, use your available tools to get real data. Don't guess — call the appropriate tool and base your answers on actual data.${skillsSection}`;
}

export class ChatService {
  private toolHandlers: Record<string, ToolHandler>;
  private approvalManager: ApprovalManager | null = null;
  private skillService: SkillService | null = null;

  constructor(
    private readonly db: StateDb,
    private readonly openai: OpenAIClient,
    linear: LinearGraphqlClient,
    cfg: AppConfig,
    trackedLinearIds?: Set<string>,
  ) {
    this.toolHandlers = createToolHandlers(db, linear, cfg, trackedLinearIds);
  }

  setApprovalManager(manager: ApprovalManager): void {
    this.approvalManager = manager;
  }

  setSkillService(service: SkillService): void {
    this.skillService = service;
  }

  /**
   * @deprecated Use handleMessageStream() for true SSE streaming.
   * This method collects all events then returns them — no incremental delivery.
   */
  async handleMessage(
    conversationId: string,
    userMessage: string,
  ): Promise<{ events: ChatStreamEvent[]; assistantMessage: ChatMessage }> {
    // Ensure conversation exists
    const conversations = this.db.getConversations();
    if (!conversations.find(c => c.id === conversationId)) {
      const title = userMessage.slice(0, 50) + (userMessage.length > 50 ? "..." : "");
      this.db.createConversation(conversationId, title);
    }

    // Save user message
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId,
      role: "user",
      content: userMessage,
      createdAt: new Date().toISOString(),
    };
    this.db.addMessage(userMsg);

    // Build message history
    const history = this.db.getMessages(conversationId);
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: buildSystemPrompt() },
      ...history.map(m => {
        if (m.role === "user") return { role: "user" as const, content: m.content };
        if (m.role === "assistant") return { role: "assistant" as const, content: m.content };
        return { role: "system" as const, content: m.content };
      }),
    ];

    const tools = getToolDefinitions();
    const events: ChatStreamEvent[] = [];
    const toolCalls: ChatToolCall[] = [];
    let fullContent = "";

    // Function calling loop
    let iterations = 0;
    const maxIterations = 5;

    while (iterations < maxIterations) {
      iterations++;
      const response = await this.openai.chat(messages, tools);
      const choice = response.choices[0];
      if (!choice) break;

      const msg = choice.message;

      if (msg.content) {
        fullContent += msg.content;
        events.push({ type: "delta", content: msg.content });
      }

      if (!msg.tool_calls?.length) break;

      // Process tool calls
      messages.push({
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.tool_calls,
      });

      for (const tc of msg.tool_calls) {
        const fn = (tc as any).function as { name: string; arguments: string };
        const toolName = fn.name;
        const toolArgs = fn.arguments;

        events.push({ type: "tool_call_start", toolCall: { id: tc.id, name: toolName } });

        let result: string;
        try {
          const handler = this.toolHandlers[toolName];
          if (!handler) {
            result = JSON.stringify({ error: `Unknown tool: ${toolName}` });
          } else {
            const parsedArgs = JSON.parse(toolArgs);
            result = await handler(parsedArgs);
          }
        } catch (error) {
          result = JSON.stringify({ error: error instanceof Error ? error.message : "Tool execution failed" });
        }

        events.push({ type: "tool_call_result", toolCall: { id: tc.id, name: toolName, result } });
        toolCalls.push({ id: tc.id, name: toolName, arguments: toolArgs, result });

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }
    }

    // Save assistant message
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId,
      role: "assistant",
      content: fullContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      createdAt: new Date().toISOString(),
    };
    this.db.addMessage(assistantMsg);

    events.push({ type: "done", messageId: assistantMsg.id });
    return { events, assistantMessage: assistantMsg };
  }

  /**
   * True SSE streaming via async generator.
   * Yields ChatStreamEvents incrementally as OpenAI streams chunks.
   */
  async *handleMessageStream(
    conversationId: string,
    userMessage: string,
  ): AsyncGenerator<ChatStreamEvent> {
    // Ensure conversation exists
    const conversations = this.db.getConversations();
    if (!conversations.find(c => c.id === conversationId)) {
      const title = userMessage.slice(0, 50) + (userMessage.length > 50 ? "..." : "");
      this.db.createConversation(conversationId, title);
    }

    // Save user message
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId,
      role: "user",
      content: userMessage,
      createdAt: new Date().toISOString(),
    };
    this.db.addMessage(userMsg);

    // Match skills before building message history
    let matchedSkills: SkillMatch[] = [];
    let skillTemplates: string[] = [];
    if (this.skillService) {
      try {
        const result = await this.skillService.matchSkills(userMessage);
        matchedSkills = result.matches;
        skillTemplates = result.templates;
        if (matchedSkills.length > 0) {
          yield { type: "skills_matched", skills: matchedSkills };
        }
      } catch { /* skill matching is best-effort */ }
    }

    // Build message history
    const history = this.db.getMessages(conversationId);
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: buildSystemPrompt(skillTemplates) },
      ...history.map(m => {
        if (m.role === "user") return { role: "user" as const, content: m.content };
        if (m.role === "assistant") return { role: "assistant" as const, content: m.content };
        return { role: "system" as const, content: m.content };
      }),
    ];

    const tools = getToolDefinitions();
    const allToolCalls: ChatToolCall[] = [];
    let fullContent = "";
    const pendingAssistantMsgId = crypto.randomUUID();

    // Function calling loop with streaming
    let iterations = 0;
    const maxIterations = 5;

    while (iterations < maxIterations) {
      iterations++;

      // Accumulate tool calls from stream chunks
      const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
      let chunkFinishReason: string | null = null;

      for await (const chunk of this.openai.chatStream(messages, tools)) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (!delta) continue;

        // Content streaming — yield each delta as it arrives
        if (delta.content) {
          fullContent += delta.content;
          yield { type: "delta", content: delta.content };
        }

        // Tool call accumulation — chunks arrive incrementally
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = pendingToolCalls.get(tc.index);
            if (!existing) {
              pendingToolCalls.set(tc.index, {
                id: tc.id || "",
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || "",
              });
            } else {
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name += tc.function.name;
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            }
          }
        }

        // Record finish reason
        if (choice.finish_reason) {
          chunkFinishReason = choice.finish_reason;
        }
      }

      // If no tool calls were requested, we are done with the LLM loop
      if (pendingToolCalls.size === 0) {
        break;
      }

      // Build tool call list from accumulated fragments
      const completedToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
      for (const [_index, tc] of pendingToolCalls) {
        completedToolCalls.push({ id: tc.id, name: tc.name, arguments: tc.arguments });
      }

      // Add assistant message with tool calls to conversation history
      messages.push({
        role: "assistant",
        content: fullContent || null,
        tool_calls: completedToolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });

      // Execute each tool call and yield events
      for (const tc of completedToolCalls) {
        const toolName = tc.name;
        const toolArgs = tc.arguments;

        // Intercept write tools: create proposal instead of executing
        if (this.approvalManager && isWriteTool(toolName)) {
          const parsedArgs = JSON.parse(toolArgs);
          const proposal = this.approvalManager.createProposal({
            conversationId,
            messageId: pendingAssistantMsgId,
            toolName,
            toolArguments: parsedArgs,
          });
          yield { type: "action_proposed", proposal };

          // Feed back a synthetic tool result telling OpenAI the action was proposed
          const proposalResult = JSON.stringify({
            status: "proposed_for_approval",
            proposalId: proposal.id,
            description: proposal.description,
            message: "This action has been proposed to the user for approval. Wait for their decision before proceeding.",
          });
          messages.push({ role: "tool", tool_call_id: tc.id, content: proposalResult });
          allToolCalls.push({ id: tc.id, name: toolName, arguments: toolArgs, result: proposalResult });
          continue; // Skip normal tool execution
        }

        yield { type: "tool_call_start", toolCall: { id: tc.id, name: toolName } };

        let result: string;
        try {
          const handler = this.toolHandlers[toolName];
          if (!handler) {
            result = JSON.stringify({ error: `Unknown tool: ${toolName}` });
          } else {
            const parsedArgs = JSON.parse(toolArgs);
            result = await handler(parsedArgs);
          }
        } catch (error) {
          result = JSON.stringify({ error: error instanceof Error ? error.message : "Tool execution failed" });
        }

        yield { type: "tool_call_result", toolCall: { id: tc.id, name: toolName, result } };
        allToolCalls.push({ id: tc.id, name: toolName, arguments: toolArgs, result });

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }

      // If finish_reason was "stop" (not "tool_calls"), break
      if (chunkFinishReason === "stop") {
        break;
      }
    }

    // Save assistant message (use pre-generated ID so proposals reference the correct message)
    const assistantMsg: ChatMessage = {
      id: pendingAssistantMsgId,
      conversationId,
      role: "assistant",
      content: fullContent,
      toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      matchedSkills: matchedSkills.length > 0 ? matchedSkills : undefined,
      createdAt: new Date().toISOString(),
    };
    this.db.addMessage(assistantMsg);

    yield { type: "done", messageId: assistantMsg.id };
  }
}
