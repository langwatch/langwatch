import { isValidSpanId, isValidTraceId } from "~/server/tracer/utils";
import type { LogCorrelationSource, LogProviderKind } from "./schema";
import { sha256 } from "./serialization";

const CLAUDE_CODE_EVENT_SCOPE = "com.anthropic.claude_code.events";
const CODEX_EVENT_NAME_PREFIX = "codex.";

/** Decodes a wire trace/span id (hex string, or raw bytes) to lowercase hex. */
export function normalizeWireId(value: unknown): string {
  if (value === undefined || value === null) return "";
  const decoded =
    value instanceof Uint8Array
      ? Buffer.from(value).toString("hex")
      : String(value);
  return decoded.toLowerCase();
}

export interface Correlation {
  readonly traceId: string;
  readonly spanId: string;
  readonly source: LogCorrelationSource;
  readonly providerKind: LogProviderKind;
}

/**
 * A record with no wire trace/span id but recognisable coding-agent detail (a
 * Claude Code `session.id`, a Codex `conversation.id`) gets a stable trace/span
 * id derived from that detail, so it still lands on the trace it belongs to.
 */
export function synthesizeCorrelation(args: {
  scopeName: string;
  wireTraceId: string;
  wireSpanId: string;
  eventName: string;
  attributes: Record<string, string>;
}): Correlation {
  const { wireTraceId, wireSpanId, attributes, eventName } = args;
  const providerKind: LogProviderKind =
    args.scopeName === CLAUDE_CODE_EVENT_SCOPE
      ? "claude_code"
      : eventName.startsWith(CODEX_EVENT_NAME_PREFIX)
        ? "codex"
        : "generic";

  if (isValidTraceId(wireTraceId) && isValidSpanId(wireSpanId)) {
    return {
      traceId: wireTraceId,
      spanId: wireSpanId,
      source: "wire",
      providerKind,
    };
  }

  if (providerKind === "claude_code") {
    const sessionId = attributes["session.id"] ?? "";
    if (sessionId) {
      const promptId = attributes["prompt.id"] ?? "";
      const turnKey = promptId ? `${sessionId}:${promptId}` : sessionId;
      const traceId = isValidTraceId(wireTraceId)
        ? wireTraceId
        : sha256(turnKey).slice(0, 32);
      const spanId = isValidSpanId(wireSpanId)
        ? wireSpanId
        : sha256(
            `${sessionId}:${promptId}:${eventName}:${attributes["event.sequence"] ?? ""}`,
          ).slice(0, 16);
      return { traceId, spanId, source: "claude_synthesized", providerKind };
    }
  }

  if (providerKind === "codex") {
    const conversationId = attributes["conversation.id"] ?? "";
    if (conversationId) {
      const traceId = isValidTraceId(wireTraceId)
        ? wireTraceId
        : sha256(conversationId).slice(0, 32);
      const spanId = isValidSpanId(wireSpanId)
        ? wireSpanId
        : sha256(
            `${conversationId}:${eventName}:${attributes["event.sequence"] ?? ""}`,
          ).slice(0, 16);
      return { traceId, spanId, source: "codex_synthesized", providerKind };
    }
  }

  return { traceId: "", spanId: "", source: "none", providerKind };
}
