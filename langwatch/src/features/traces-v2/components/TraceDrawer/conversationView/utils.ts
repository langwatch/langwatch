import {
  abbreviateModel,
  formatDuration,
  formatRelativeTime,
} from "../../../utils/formatters";
import type { ParsedTurn } from "./types";

export function buildConversationMarkdown(
  conversationId: string,
  parsedTurns: ParsedTurn[],
): string {
  const lines: string[] = [];
  lines.push(`# Conversation \`${conversationId}\``);
  lines.push("");
  const systemPrompt = parseSystemPrompt(parsedTurns[0]?.turn.input);
  if (systemPrompt) {
    lines.push("## System");
    lines.push("");
    lines.push("```");
    lines.push(systemPrompt);
    lines.push("```");
    lines.push("");
  }
  lines.push(`- **Turns:** ${parsedTurns.length}`);
  if (parsedTurns.length > 0) {
    const first = parsedTurns[0]!.turn;
    const last = parsedTurns[parsedTurns.length - 1]!.turn;
    lines.push(`- **Started:** ${new Date(first.timestamp).toISOString()}`);
    lines.push(`- **Last turn:** ${new Date(last.timestamp).toISOString()}`);
    let totalCost = 0;
    let totalTokens = 0;
    for (const p of parsedTurns) {
      totalCost += p.turn.totalCost ?? 0;
      totalTokens += p.turn.totalTokens;
    }
    if (totalCost > 0) lines.push(`- **Total cost:** $${totalCost.toFixed(4)}`);
    if (totalTokens > 0) lines.push(`- **Total tokens:** ${totalTokens}`);
  }
  lines.push("");

  for (let i = 0; i < parsedTurns.length; i++) {
    const { turn, userText } = parsedTurns[i]!;
    const model = turn.models[0] ? abbreviateModel(turn.models[0]) : "—";
    lines.push(
      `## Turn ${i + 1} — ${formatRelativeTime(turn.timestamp)} · ${model} · ${formatDuration(turn.durationMs)}`,
    );
    lines.push("");

    if (userText) {
      lines.push("**User:**");
      lines.push("");
      lines.push(userText);
      lines.push("");
    }

    if (turn.output) {
      lines.push("**Assistant:**");
      lines.push("");
      lines.push(turn.output);
      lines.push("");
    } else if (turn.error) {
      lines.push("**Error:**");
      lines.push("");
      lines.push("```");
      lines.push(turn.error);
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd();
}

/**
 * Extract the first system message from the chat-history input. Used to render
 * the conversation-level system prompt banner. Returns "" if not chat-shaped or
 * no system role present.
 */
export function parseSystemPrompt(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const sys = parsed.find(
        (m) => m && typeof m === "object" && m.role === "system",
      );
      if (sys) return contentToString(sys.content);
    }
  } catch {
    // not JSON
  }
  return "";
}

/**
 * The `input` field on a trace is often the full chat history (system + earlier
 * turns + the latest user message). For chat rendering we want just the latest
 * user message — that's the new content this turn.
 */
export function parseLastUserText(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const lastUser = [...parsed]
        .reverse()
        .find((m) => m && typeof m === "object" && m.role === "user");
      if (lastUser) return contentToString(lastUser.content);
    }
    if (typeof parsed === "object" && parsed !== null) {
      return JSON.stringify(parsed);
    }
  } catch {
    // not JSON
  }
  return raw;
}

export function contentToString(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return JSON.stringify(content);
}

export function formatGap(secs: number): string {
  if (secs < 60) return `${secs.toFixed(1)}s gap`;
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}m ${s}s gap`;
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m gap`;
}
