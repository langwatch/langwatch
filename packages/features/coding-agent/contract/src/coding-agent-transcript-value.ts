import { readString } from "./telemetry/coding-agent-span";
import type { SpanDetail } from "@langwatch/trace-contract";

export { readString } from "./telemetry/coding-agent-span";

export function readUnknown(
  attrs: Record<string, unknown> | null | undefined,
  key: string,
): unknown {
  if (!attrs) return void 0;
  if (attrs[key] !== void 0) return attrs[key];
  if (!key.includes(".")) return void 0;

  let cursor: unknown = attrs;
  for (const segment of key.split(".")) {
    if (cursor === null || typeof cursor !== "object") return void 0;
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return cursor;
}

export function readNumber(
  attrs: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = readUnknown(attrs, key);
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value.trim() === "") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseMaybeJson(raw: string | null): unknown {
  if (raw === null) return null;

  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return raw;

  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

export function modelOf(span: SpanDetail): string | null {
  return (
    readString(span.params, "gen_ai.request.model") ??
    readString(span.params, "ai.model.id") ??
    readString(span.params, "model")
  );
}
