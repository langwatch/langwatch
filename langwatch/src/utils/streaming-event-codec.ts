/**
 * Compact streaming event codec for SSE broadcasts.
 *
 * Minimises payload for high-frequency CONTENT events.
 * Single-letter keys keep JSON under 100 bytes per delta.
 *
 * Keys:
 *   e = event type  (S=start, C=content, E=end)
 *   r = scenarioRunId
 *   b = batchRunId
 *   m = messageId
 *   d = delta       (C only)
 *   c = content     (E only)
 *   l = role        (S only)
 *   i = messageIndex (S only, optional)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompactEventType = "S" | "C" | "E";

export interface CompactStreamingEvent {
  e: CompactEventType;
  r: string;
  b: string;
  m: string;
  d?: string;
  c?: string;
  l?: string;
  i?: number;
}

// ---------------------------------------------------------------------------
// Encode (server → SSE)
// ---------------------------------------------------------------------------

export function encodeStart(fields: {
  scenarioRunId: string;
  batchRunId: string;
  messageId: string;
  role: string;
  messageIndex?: number;
}): string {
  const obj: CompactStreamingEvent = {
    e: "S",
    r: fields.scenarioRunId,
    b: fields.batchRunId,
    m: fields.messageId,
    l: fields.role,
  };
  if (fields.messageIndex != null) obj.i = fields.messageIndex;
  return JSON.stringify(obj);
}

export function encodeContent(fields: {
  scenarioRunId: string;
  batchRunId: string;
  messageId: string;
  delta: string;
}): string {
  return JSON.stringify({
    e: "C",
    r: fields.scenarioRunId,
    b: fields.batchRunId,
    m: fields.messageId,
    d: fields.delta,
  } satisfies CompactStreamingEvent);
}

export function encodeEnd(fields: {
  scenarioRunId: string;
  batchRunId: string;
  messageId: string;
  content?: string;
}): string {
  const obj: CompactStreamingEvent = {
    e: "E",
    r: fields.scenarioRunId,
    b: fields.batchRunId,
    m: fields.messageId,
  };
  if (fields.content != null) obj.c = fields.content;
  return JSON.stringify(obj);
}

// ---------------------------------------------------------------------------
// Decode (SSE → client)
// ---------------------------------------------------------------------------

export function isCompactStreamingEvent(
  parsed: unknown,
): parsed is CompactStreamingEvent {
  if (typeof parsed !== "object" || parsed === null) return false;
  const p = parsed as Record<string, unknown>;
  return p.e === "S" || p.e === "C" || p.e === "E";
}
