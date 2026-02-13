import type OpenAI from "openai";
import type { AppConfig } from "../config";

export class OpenAIClient {
  constructor(private readonly cfg: AppConfig) {}

  async chat(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.openaiModel,
        messages,
        ...(tools?.length ? { tools } : {}),
      }),
    });
    if (!response.ok) throw new Error(`OpenAI API ${response.status}`);
    return (await response.json()) as OpenAI.Chat.Completions.ChatCompletion;
  }

  async createEmbedding(text: string): Promise<number[]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
      }),
    });
    if (!response.ok) throw new Error(`OpenAI Embeddings API ${response.status}`);
    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  }

  async createEmbeddingBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: texts,
      }),
    });
    if (!response.ok) throw new Error(`OpenAI Embeddings API ${response.status}`);
    const data = (await response.json()) as { data: Array<{ embedding: number[]; index: number }> };
    // Sort by index to match input order
    return data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
  }

  async *chatStream(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
  ): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.openaiModel,
        messages,
        stream: true,
        ...(tools?.length ? { tools } : {}),
      }),
    });
    if (!response.ok) throw new Error(`OpenAI API ${response.status}`);
    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;
        try {
          yield JSON.parse(data) as OpenAI.Chat.Completions.ChatCompletionChunk;
        } catch { /* skip malformed */ }
      }
    }
  }
}
