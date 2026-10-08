import type {
  CanonicalLogRecord,
  LogCorrelationSource,
  LogProviderKind,
} from "@langwatch/log-contract";
import { z } from "zod";

import { isRecord, sha256 } from "./canonical-log-value.rules.ts";

const CLAUDE_CODE_EVENT_SCOPE = "com.anthropic.claude_code.events";
const CODEX_EVENT_NAME_PREFIX = "codex.";

export function normalizeId(value: unknown): string {
  if (value === undefined || value === null) return "";
  const normalized = value instanceof Uint8Array ? Buffer.from(value).toString("hex") : value;
  return typeof normalized === "string" ? normalized.toLowerCase() : "";
}

function validTraceId(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value) && !/^0+$/.test(value);
}

function validSpanId(value: string): boolean {
  return /^[a-f0-9]{16}$/.test(value) && !/^0+$/.test(value);
}

export function synthesizeCorrelation(args: {
  scopeName: string;
  wireTraceId: string;
  wireSpanId: string;
  eventName: string;
  attributes: Record<string, string>;
}): {
  traceId: string;
  spanId: string;
  source: LogCorrelationSource;
  providerKind: LogProviderKind;
} {
  const { wireTraceId, wireSpanId, attributes } = args;
  const eventName = args.eventName;
  let providerKind: LogProviderKind;
  if (args.scopeName === CLAUDE_CODE_EVENT_SCOPE) {
    providerKind = "claude_code";
  } else if (eventName.startsWith(CODEX_EVENT_NAME_PREFIX)) {
    providerKind = "codex";
  } else {
    providerKind = "generic";
  }
  if (validTraceId(wireTraceId) && validSpanId(wireSpanId)) {
    return {
      traceId: wireTraceId,
      spanId: wireSpanId,
      source: "wire",
      providerKind,
    };
  }
  const sessionId = attributes["session.id"] ?? "";
  if (providerKind === "claude_code" && sessionId) {
    return claudeSynthesizedCorrelation({
      sessionId,
      wireTraceId,
      wireSpanId,
      eventName,
      attributes,
    });
  }
  const conversationId = attributes["conversation.id"] ?? "";
  if (providerKind === "codex" && conversationId) {
    return codexSynthesizedCorrelation({
      conversationId,
      wireTraceId,
      wireSpanId,
      eventName,
      attributes,
    });
  }
  return { traceId: "", spanId: "", source: "none", providerKind };
}

function claudeSynthesizedCorrelation(args: {
  sessionId: string;
  wireTraceId: string;
  wireSpanId: string;
  eventName: string;
  attributes: Record<string, string>;
}): {
  traceId: string;
  spanId: string;
  source: LogCorrelationSource;
  providerKind: LogProviderKind;
} {
  const { sessionId, wireTraceId, wireSpanId, eventName, attributes } = args;
  const promptId = attributes["prompt.id"] ?? "";
  const turnKey = promptId ? `${sessionId}:${promptId}` : sessionId;
  const traceId = validTraceId(wireTraceId) ? wireTraceId : sha256(turnKey).slice(0, 32);
  const spanId = validSpanId(wireSpanId)
    ? wireSpanId
    : sha256(`${sessionId}:${promptId}:${eventName}:${attributes["event.sequence"] ?? ""}`).slice(
        0,
        16,
      );
  return {
    traceId,
    spanId,
    source: "claude_synthesized",
    providerKind: "claude_code",
  };
}

function codexSynthesizedCorrelation(args: {
  conversationId: string;
  wireTraceId: string;
  wireSpanId: string;
  eventName: string;
  attributes: Record<string, string>;
}): {
  traceId: string;
  spanId: string;
  source: LogCorrelationSource;
  providerKind: LogProviderKind;
} {
  const { conversationId, wireTraceId, wireSpanId, eventName, attributes } = args;
  const traceId = validTraceId(wireTraceId) ? wireTraceId : sha256(conversationId).slice(0, 32);
  const spanId = validSpanId(wireSpanId)
    ? wireSpanId
    : sha256(`${conversationId}:${eventName}:${attributes["event.sequence"] ?? ""}`).slice(0, 16);
  return {
    traceId,
    spanId,
    source: "codex_synthesized",
    providerKind: "codex",
  };
}

export function bodyType(body: unknown): CanonicalLogRecord["bodyType"] {
  if (!isRecord(body)) return "empty";
  const parsed = z
    .enum(["empty", "string", "bool", "int", "double", "bytes", "array", "kvlist"])
    .safeParse(body.type);
  return parsed.success ? parsed.data : "empty";
}

export type BodyText = { present: true; text: string } | { present: false };

export function bodyText(body: unknown): BodyText {
  if (isRecord(body) && body.type === "string" && typeof body.value === "string") {
    return { present: true, text: body.value };
  }
  return { present: false };
}

export function effectiveTimestamp({
  timeUnixNano,
  observedTimeUnixNano,
  acceptedAt,
}: {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  acceptedAt: number;
}): string {
  if (timeUnixNano !== "0") return timeUnixNano;
  if (observedTimeUnixNano !== "0") return observedTimeUnixNano;
  return String(BigInt(acceptedAt) * 1_000_000n);
}
