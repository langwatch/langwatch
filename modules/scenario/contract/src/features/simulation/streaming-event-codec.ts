/**
 * Compact SSE streaming events, under 100 bytes per delta. e: S(start) C(content) E(end)
 * R(snapshot stored: drop the run's previews and refetch; older clients ignore it).
 * Keys: r(runId), b(batchId), m(msgId, not on R), d(delta), c(content), l(role), i(index).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompactEventType = "S" | "C" | "E" | "R";

export interface CompactStreamingEvent {
  e: CompactEventType;
  r: string;
  b: string;
  /** Absent on R, which names a run rather than a message. */
  m?: string;
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

/** A message snapshot was stored: it, not the streamed previews, is the run's truth. */
export function encodeReset(fields: { scenarioRunId: string; batchRunId: string }): string {
  return JSON.stringify({
    e: "R",
    r: fields.scenarioRunId,
    b: fields.batchRunId,
  } satisfies CompactStreamingEvent);
}

// ---------------------------------------------------------------------------
// Decode (SSE → client)
// ---------------------------------------------------------------------------

export function isCompactStreamingEvent(parsed: unknown): parsed is CompactStreamingEvent {
  if (typeof parsed !== "object" || parsed === null) return false;
  const p = parsed as Record<string, unknown>;
  return p.e === "S" || p.e === "C" || p.e === "E" || p.e === "R";
}
