const MODEL_CALL_SPAN_NAMES = new Set([
  "claude_code.llm_request",
  "opencode.llm",
  "ai.streamText",
  "llm_call",
  "session_task.turn",
  "chat",
]);

const MODEL_CALL_SPAN_EXCLUDES = new Set(["ai.streamText.doStream"]);

export function isModelCallSpan(spanName: string): boolean {
  if (MODEL_CALL_SPAN_EXCLUDES.has(spanName)) return false;
  if (MODEL_CALL_SPAN_NAMES.has(spanName)) return true;
  return spanName.startsWith("chat ");
}

export function readString(
  attributes: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = readAttribute(attributes, key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readAttribute(
  attributes: Record<string, unknown> | null | undefined,
  key: string,
): unknown {
  if (!attributes) return void 0;
  if (attributes[key] !== void 0) return attributes[key];
  if (!key.includes(".")) return void 0;

  let cursor: unknown = attributes;
  for (const segment of key.split(".")) {
    if (cursor === null || typeof cursor !== "object") return void 0;
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return cursor;
}
