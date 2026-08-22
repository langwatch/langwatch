/**
 * Handoff digest: a bounded plain-text rendering of the conversation for the
 * resumed worker's context seed. Newest messages are kept whole (up to a
 * per-message cap), oldest are dropped first; a truncation marker records the
 * drop. Hard bound: DIGEST_MAX_BYTES (64KB).
 */

import { truncateToBytes } from "./protocol.js";

export const DIGEST_MAX_BYTES = 64 * 1024;
export const DIGEST_MESSAGE_MAX_BYTES = 8 * 1024;
export const DIGEST_TRUNCATION_HEADER = "[digest truncated: older messages omitted]";

type ContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: unknown;
};

type DigestibleMessage = {
  role?: string;
  toolName?: string;
  content?: string | ContentBlock[];
  isError?: boolean;
};

function renderContent(content: string | ContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "toolCall") {
      let args = "";
      try {
        args = JSON.stringify(block.arguments);
      } catch {
        args = "[unserializable arguments]";
      }
      parts.push(`[tool call: ${block.name ?? "unknown"} ${args}]`);
    }
    // thinking blocks are deliberately dropped: they are not resumable context.
  }
  return parts.join("\n");
}

export function renderMessageLine(message: DigestibleMessage): string | undefined {
  const role = message.role ?? "unknown";
  if (role === "bashExecution") return undefined;
  const body = renderContent(message.content);
  if (body.trim().length === 0) return undefined;
  const label =
    role === "toolResult"
      ? `toolResult(${message.toolName ?? "unknown"}${message.isError ? ", error" : ""})`
      : role;
  const line = `${label}: ${body}`;
  if (Buffer.byteLength(line, "utf8") <= DIGEST_MESSAGE_MAX_BYTES) return line;
  return `${truncateToBytes({ text: line, maxBytes: DIGEST_MESSAGE_MAX_BYTES })}\n[message truncated]`;
}

export function buildHandoffDigest({
  messages,
  maxBytes = DIGEST_MAX_BYTES,
}: {
  messages: unknown[];
  maxBytes?: number;
}): string {
  const headerBytes = Buffer.byteLength(`${DIGEST_TRUNCATION_HEADER}\n`, "utf8");
  const kept: string[] = [];
  let used = 0;
  let truncated = false;

  for (let i = messages.length - 1; i >= 0; i--) {
    const line = renderMessageLine((messages[i] ?? {}) as DigestibleMessage);
    if (line === undefined) continue;
    const cost = Buffer.byteLength(line, "utf8") + 1; // + newline
    // Reserve room for the truncation header in case older messages remain.
    if (used + cost > maxBytes - headerBytes) {
      truncated = true;
      break;
    }
    kept.push(line);
    used += cost;
  }

  kept.reverse();
  if (truncated) kept.unshift(DIGEST_TRUNCATION_HEADER);
  return kept.join("\n");
}
