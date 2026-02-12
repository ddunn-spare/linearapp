import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Box, Typography, TextField, IconButton, Paper, Chip, Button,
  CircularProgress, Fade,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import BuildIcon from "@mui/icons-material/Build";
import type { ActionProposal, ActionState, ChatConversation, ChatMessage, ChatStreamEvent } from "@linearapp/shared";
import {
  getConversations, createConversation, getMessages,
  streamChat, approveAction, declineAction, retryAction,
  getConversationProposals,
} from "../api";
import ApprovalCard from "../components/ApprovalCard";

// ─── Approve All Button ───

function ApproveAllButton({ proposals, onApproveAll }: { proposals: ActionProposal[]; onApproveAll: (ids: string[]) => void }) {
  const pendingIds = proposals.filter(p => p.state === "proposed").map(p => p.id);
  if (pendingIds.length < 2) return null;
  return (
    <Button
      variant="outlined"
      size="small"
      onClick={() => onApproveAll(pendingIds)}
      sx={{ alignSelf: "flex-start", mb: 0.5, fontSize: "0.75rem" }}
    >
      Approve All ({pendingIds.length})
    </Button>
  );
}

// ─── Message Components ───

function AssistantMessage({ content, toolCalls, proposals, onApprove, onDecline, onRetry }: {
  content: string;
  toolCalls?: ChatMessage["toolCalls"];
  proposals?: ActionProposal[];
  onApprove: (id: string) => Promise<boolean>;
  onDecline: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const handleApproveAll = useCallback(async (ids: string[]) => {
    for (const id of ids) {
      const success = await onApprove(id);
      if (!success) break; // Halt: keep remaining pending
    }
  }, [onApprove]);

  return (
    <Box sx={{ display: "flex", gap: 1.5, mb: 3, maxWidth: 720 }}>
      <Box sx={{
        width: 28, height: 28, borderRadius: "50%", bgcolor: "secondary.main",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, mt: 0.25,
      }}>
        <SmartToyIcon sx={{ fontSize: 16, color: "white" }} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        {toolCalls && toolCalls.length > 0 && (
          <Box sx={{ mb: 1 }}>
            {toolCalls.map(tc => (
              <Chip
                key={tc.id}
                icon={<BuildIcon sx={{ fontSize: "14px !important" }} />}
                label={tc.name.replace(/_/g, " ")}
                size="small"
                variant="outlined"
                sx={{ mr: 0.5, mb: 0.5, height: 24, fontSize: "0.7rem", borderColor: "rgba(255,255,255,0.12)" }}
              />
            ))}
          </Box>
        )}
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.7, color: "text.primary" }}>
          {content}
        </Typography>
        {proposals && proposals.length > 0 && (
          <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
            <ApproveAllButton proposals={proposals} onApproveAll={handleApproveAll} />
            {proposals.map(p => (
              <ApprovalCard
                key={p.id}
                proposal={p}
                onApprove={onApprove}
                onDecline={onDecline}
                onRetry={onRetry}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 3, maxWidth: 720, ml: "auto" }}>
      <Paper sx={{
        px: 2, py: 1.25, bgcolor: "primary.main", color: "white",
        borderRadius: "16px 16px 4px 16px", maxWidth: "80%",
      }}>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
          {content}
        </Typography>
      </Paper>
    </Box>
  );
}

function StreamingMessage({ content, tools, proposals, onApprove, onDecline, onRetry }: {
  content: string;
  tools: string[];
  proposals?: ActionProposal[];
  onApprove: (id: string) => Promise<boolean>;
  onDecline: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  return (
    <Box sx={{ display: "flex", gap: 1.5, mb: 3, maxWidth: 720 }}>
      <Box sx={{
        width: 28, height: 28, borderRadius: "50%", bgcolor: "secondary.main",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, mt: 0.25,
      }}>
        <SmartToyIcon sx={{ fontSize: 16, color: "white" }} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        {tools.length > 0 && (
          <Box sx={{ mb: 1 }}>
            {tools.map(t => (
              <Chip
                key={t}
                icon={<CircularProgress size={10} sx={{ color: "secondary.main" }} />}
                label={t.replace(/_/g, " ")}
                size="small"
                sx={{ mr: 0.5, mb: 0.5, height: 24, fontSize: "0.7rem", bgcolor: "rgba(38,166,154,0.1)", borderColor: "rgba(38,166,154,0.3)", border: "1px solid" }}
              />
            ))}
          </Box>
        )}
        {content ? (
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.7, color: "text.primary" }}>
            {content}
            <Box component="span" sx={{ display: "inline-block", width: 6, height: 14, bgcolor: "text.secondary", ml: 0.25, animation: "blink 1s step-end infinite", "@keyframes blink": { "50%": { opacity: 0 } } }} />
          </Typography>
        ) : (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.5 }}>
            <CircularProgress size={14} sx={{ color: "text.secondary" }} />
            <Typography variant="body2" color="text.secondary">Thinking...</Typography>
          </Box>
        )}
        {proposals && proposals.length > 0 && (
          <Box sx={{ mt: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
            {proposals.map(p => (
              <ApprovalCard
                key={p.id}
                proposal={p}
                onApprove={onApprove}
                onDecline={onDecline}
                onRetry={onRetry}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

const SUGGESTIONS = [
  "Who is overloaded right now?",
  "Give me a team workload summary",
  "What should we prioritize next?",
  "Show me the current cycle progress",
];

export default function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(searchParams.get("c"));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [proposals, setProposals] = useState<Map<string, ActionProposal>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track the message ID for the current streaming response so proposals can be matched
  const streamingMessageIdRef = useRef<string>(crypto.randomUUID());

  const loadConversations = useCallback(async () => {
    try {
      const res = await getConversations();
      setConversations(res.conversations);
    } catch { /* ignore */ }
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    try {
      const res = await getMessages(convId);
      setMessages(res.messages);
    } catch { /* ignore */ }
  }, []);

  const loadProposals = useCallback(async (convId: string) => {
    try {
      const res = await getConversationProposals(convId);
      const map = new Map(res.proposals.map(p => [p.id, p]));
      setProposals(map);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Sync activeConvId from URL search params
  useEffect(() => {
    const convParam = searchParams.get("c");
    const isNew = searchParams.get("new");
    if (isNew) {
      setActiveConvId(null);
      setMessages([]);
      setProposals(new Map());
      setSearchParams({}, { replace: true });
      setTimeout(() => inputRef.current?.focus(), 100);
    } else if (convParam && convParam !== activeConvId) {
      setActiveConvId(convParam);
    }
  }, [searchParams]);

  useEffect(() => {
    if (activeConvId) {
      loadMessages(activeConvId);
      loadProposals(activeConvId);
    } else {
      setMessages([]);
      setProposals(new Map());
    }
  }, [activeConvId, loadMessages, loadProposals]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamContent, proposals]);

  // ─── Action Handlers ───

  const handleApprove = useCallback(async (proposalId: string): Promise<boolean> => {
    // Optimistic update: set state to executing immediately
    setProposals(prev => {
      const next = new Map(prev);
      const existing = next.get(proposalId);
      if (existing) next.set(proposalId, { ...existing, state: "executing" as ActionState, updatedAt: new Date().toISOString() });
      return next;
    });
    try {
      const res = await approveAction(proposalId);
      setProposals(prev => new Map(prev).set(proposalId, res.proposal));
      return res.proposal.state === "succeeded";
    } catch (error) {
      setProposals(prev => {
        const next = new Map(prev);
        const existing = next.get(proposalId);
        if (existing) next.set(proposalId, { ...existing, state: "failed" as ActionState, error: error instanceof Error ? error.message : "Approve failed" });
        return next;
      });
      return false;
    }
  }, []);

  const handleDecline = useCallback(async (proposalId: string) => {
    setProposals(prev => {
      const next = new Map(prev);
      const existing = next.get(proposalId);
      if (existing) next.set(proposalId, { ...existing, state: "declined" as ActionState, updatedAt: new Date().toISOString() });
      return next;
    });
    try {
      await declineAction(proposalId);
    } catch { /* decline is best-effort */ }
  }, []);

  const handleRetry = useCallback(async (proposalId: string) => {
    setProposals(prev => {
      const next = new Map(prev);
      const existing = next.get(proposalId);
      if (existing) next.set(proposalId, { ...existing, state: "executing" as ActionState, error: undefined, updatedAt: new Date().toISOString() });
      return next;
    });
    try {
      const res = await retryAction(proposalId);
      setProposals(prev => new Map(prev).set(proposalId, res.proposal));
    } catch (error) {
      setProposals(prev => {
        const next = new Map(prev);
        const existing = next.get(proposalId);
        if (existing) next.set(proposalId, { ...existing, state: "failed" as ActionState, error: error instanceof Error ? error.message : "Retry failed" });
        return next;
      });
    }
  }, []);

  // ─── Send Message & Stream ───

  const handleSend = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || streaming) return;

    let convId = activeConvId;
    if (!convId) {
      const res = await createConversation(msg.slice(0, 50));
      convId = res.conversation.id;
      setActiveConvId(convId);
      setConversations(prev => [res.conversation, ...prev]);
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId: convId,
      role: "user",
      content: msg,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setStreaming(true);
    setStreamContent("");
    setActiveTools([]);

    // Generate a streaming message ID early so SSE proposals can be matched
    const currentStreamMsgId = crypto.randomUUID();
    streamingMessageIdRef.current = currentStreamMsgId;

    let fullContent = "";
    const toolCalls: any[] = [];

    abortRef.current = streamChat(convId, userMsg.content, (event: ChatStreamEvent) => {
      switch (event.type) {
        case "delta":
          fullContent += event.content;
          setStreamContent(fullContent);
          break;
        case "tool_call_start":
          setActiveTools(prev => [...prev, event.toolCall.name]);
          break;
        case "tool_call_result":
          toolCalls.push(event.toolCall);
          setActiveTools(prev => prev.filter(t => t !== event.toolCall.name));
          break;
        case "action_proposed":
          setProposals(prev => new Map(prev).set(event.proposal.id, event.proposal));
          break;
        case "action_update":
          setProposals(prev => {
            const next = new Map(prev);
            const existing = next.get(event.proposalId);
            if (existing) {
              next.set(event.proposalId, {
                ...existing,
                state: event.state,
                result: event.result ?? existing.result,
                resultUrl: event.resultUrl ?? existing.resultUrl,
                error: event.error ?? existing.error,
                updatedAt: new Date().toISOString(),
              });
            }
            return next;
          });
          break;
        case "done":
          setStreaming(false);
          setStreamContent("");
          setMessages(prev => [
            ...prev,
            {
              id: event.messageId,
              conversationId: convId!,
              role: "assistant",
              content: fullContent,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              createdAt: new Date().toISOString(),
            },
          ]);
          loadConversations();
          break;
        case "error":
          setStreaming(false);
          setStreamContent("");
          setMessages(prev => [
            ...prev,
            {
              id: crypto.randomUUID(),
              conversationId: convId!,
              role: "assistant",
              content: `Error: ${event.error}`,
              createdAt: new Date().toISOString(),
            },
          ]);
          break;
      }
    });
  };

  // ─── Helpers for rendering proposals per message ───

  const getProposalsForMessage = (messageId: string) =>
    Array.from(proposals.values()).filter(p => p.messageId === messageId);

  const getStreamingProposals = () =>
    Array.from(proposals.values()).filter(p => p.messageId === streamingMessageIdRef.current);

  const isEmpty = messages.length === 0 && !streaming;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "calc(100vh - 48px)", maxWidth: 800, mx: "auto" }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 1.5, px: 1 }}>
        <SmartToyIcon sx={{ color: "secondary.main" }} />
        <Typography variant="subtitle1" fontWeight={600}>
          {activeConvId ? conversations.find(c => c.id === activeConvId)?.title : "AI Assistant"}
        </Typography>
      </Box>

      {/* Messages */}
      <Box sx={{ flexGrow: 1, overflow: "auto", px: 2, py: 2 }}>
        {isEmpty && (
          <Fade in>
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 3 }}>
              <Box sx={{
                width: 56, height: 56, borderRadius: "50%",
                bgcolor: "rgba(38,166,154,0.1)", border: "2px solid rgba(38,166,154,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <SmartToyIcon sx={{ fontSize: 28, color: "secondary.main" }} />
              </Box>
              <Box sx={{ textAlign: "center" }}>
                <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>What can I help with?</Typography>
                <Typography variant="body2" color="text.secondary">
                  Ask about workload, priorities, cycle progress, or anything about your team.
                </Typography>
              </Box>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, justifyContent: "center", maxWidth: 500 }}>
                {SUGGESTIONS.map(s => (
                  <Chip
                    key={s}
                    label={s}
                    variant="outlined"
                    onClick={() => handleSend(s)}
                    sx={{
                      cursor: "pointer", borderColor: "rgba(255,255,255,0.12)",
                      "&:hover": { bgcolor: "rgba(255,255,255,0.04)", borderColor: "primary.main" },
                    }}
                  />
                ))}
              </Box>
            </Box>
          </Fade>
        )}

        {messages.map(msg => {
          const msgProposals = msg.role === "assistant"
            ? getProposalsForMessage(msg.id)
            : [];
          return msg.role === "user"
            ? <UserMessage key={msg.id} content={msg.content} />
            : <AssistantMessage
                key={msg.id}
                content={msg.content}
                toolCalls={msg.toolCalls}
                proposals={msgProposals}
                onApprove={handleApprove}
                onDecline={handleDecline}
                onRetry={handleRetry}
              />;
        })}

        {streaming && (
          <StreamingMessage
            content={streamContent}
            tools={activeTools}
            proposals={getStreamingProposals()}
            onApprove={handleApprove}
            onDecline={handleDecline}
            onRetry={handleRetry}
          />
        )}

        <div ref={messagesEndRef} />
      </Box>

      {/* Input */}
      <Box sx={{ px: 2, pb: 2, pt: 1 }}>
        <Paper sx={{
          display: "flex", alignItems: "flex-end", gap: 1,
          p: 1, bgcolor: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 3,
          "&:focus-within": { borderColor: "primary.main" },
        }}>
          <TextField
            inputRef={inputRef}
            fullWidth
            placeholder="Ask anything..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={streaming}
            multiline
            maxRows={4}
            variant="standard"
            InputProps={{ disableUnderline: true }}
            sx={{ "& .MuiInputBase-input": { py: 0.75, px: 1 } }}
          />
          <IconButton
            onClick={() => handleSend()}
            disabled={streaming || !input.trim()}
            sx={{
              bgcolor: input.trim() ? "primary.main" : "transparent",
              color: input.trim() ? "white" : "text.secondary",
              width: 36, height: 36,
              "&:hover": { bgcolor: input.trim() ? "primary.dark" : "rgba(255,255,255,0.04)" },
              "&.Mui-disabled": { bgcolor: "transparent" },
            }}
          >
            <SendIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Paper>
      </Box>
    </Box>
  );
}
