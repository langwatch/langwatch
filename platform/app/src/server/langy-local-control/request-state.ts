/**
 * What became of a conversation's latest control request (ADR-129).
 *
 * An open request lives in Redis for fifteen minutes and is forgotten when it
 * is approved, declined or expires, so "no open request" alone cannot tell a
 * card why there is nothing to approve. The conversation's own event log can:
 * it records every request with its expiry, and every folder connection with
 * the request that opened it. Read together, the two answer with one state.
 *
 *   open      a terminal can approve it right now, or has just approved it
 *             and the folder is on its way
 *   approved  it was approved, and the folder it opened is connected
 *   expired   its fifteen minutes ran out
 *   declined  it was declined in the terminal before it expired
 *   ended     it was approved, and the share it opened has ended
 *   none      the conversation never asked for a folder
 */
import { LANGY_CONVERSATION_EVENT_TYPES } from "@langwatch/langy";

export const CONTROL_REQUEST_STATES = [
  "open",
  "approved",
  "expired",
  "declined",
  "ended",
  "none",
] as const;
export type ControlRequestState = (typeof CONTROL_REQUEST_STATES)[number];

/** The part of a conversation event this reading needs. */
export interface ControlRequestHistoryEvent {
  type: string;
  data: unknown;
}

/** The latest request a conversation recorded, and whether a folder came of it. */
export interface LatestControlRequest {
  requestId: string;
  /** Unix ms after which the request is refused. */
  expiresAt: number;
  /** A folder connected through this request. */
  approved: boolean;
}

const field = (data: unknown, key: string): unknown =>
  typeof data === "object" && data !== null
    ? (data as Record<string, unknown>)[key]
    : undefined;

/** The last request in the log, or nothing when the conversation never asked. */
export function latestControlRequest(
  events: readonly ControlRequestHistoryEvent[],
): LatestControlRequest | null {
  let latest: LatestControlRequest | null = null;
  for (const event of events) {
    if (event.type === LANGY_CONVERSATION_EVENT_TYPES.LOCAL_CONTROL_REQUESTED) {
      const requestId = field(event.data, "requestId");
      const expiresAt = field(event.data, "expiresAt");
      if (typeof requestId !== "string" || typeof expiresAt !== "number") {
        continue;
      }
      latest = { requestId, expiresAt, approved: false };
      continue;
    }
    if (
      latest &&
      event.type === LANGY_CONVERSATION_EVENT_TYPES.LOCAL_WORKSPACE_CONNECTED &&
      field(event.data, "requestId") === latest.requestId
    ) {
      latest = { ...latest, approved: true };
    }
  }
  return latest;
}

/**
 * The one state of the latest request. `open` is the open request Redis still
 * holds for the conversation; the log answers only when there is none.
 *
 * `claimed` is the approval's own mark. An approval spends the request before
 * the folder connects, so for that moment the request is neither open nor
 * connected: it still reads as open, because the terminal did not decline it.
 */
export function controlRequestState({
  open,
  latest,
  claimed,
  connected,
  now,
}: {
  open: { expiresAt: number } | null;
  latest: LatestControlRequest | null;
  claimed: boolean;
  /** A folder is connected to the conversation right now. */
  connected: boolean;
  now: number;
}): ControlRequestState {
  if (connected) return "approved";
  if (open && open.expiresAt > now) return "open";
  if (open) return "expired";
  if (!latest) return "none";
  if (latest.approved) return "ended";
  if (latest.expiresAt <= now) return "expired";
  return claimed ? "open" : "declined";
}
