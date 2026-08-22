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
const MESSAGE_TRUNCATION_MARKER = "\n[message truncated]";

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
    // A persisted message can carry a null or scalar member. Reading .type off
    // one throws, and runner.ts turns the throw into an EMPTY handoff seed —
    // the resumed worker silently loses the whole conversation.
    if (block === null || typeof block !== "object") continue;
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
  // The marker is part of the per-message budget, not an addition to it: the
  // per-message cap is what buildHandoffDigest counts against the whole digest.
  const budget =
    DIGEST_MESSAGE_MAX_BYTES - Buffer.byteLength(MESSAGE_TRUNCATION_MARKER, "utf8");
  return `${truncateToBytes({ text: line, maxBytes: budget })}${MESSAGE_TRUNCATION_MARKER}`;
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
  // maxBytes is a HARD bound, so the header only goes on when it fits. Below
  // its own size there is nothing truthful left to return: a budget that
  // cannot hold the "older messages omitted" line cannot hold a digest either.
  if (truncated) {
    if (headerBytes > maxBytes) return "";
    kept.unshift(DIGEST_TRUNCATION_HEADER);
  }
  return kept.join("\n");
}
