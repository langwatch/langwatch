/**
 * What became of a conversation's latest control request (ADR-129): open, approved, expired,
 * declined, ended or none, read from Redis and the conversation's event log together.
 */
import {
  LANGY_CONVERSATION_EVENT_TYPES,
  type LangyControlRequestState,
} from "@langwatch/langy-contract";

export type ControlRequestState = LangyControlRequestState;

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

/** What the log holds: a request, or the plain fact that the conversation never asked. */
export type LatestControlRequestReading =
  | { kind: "recorded"; request: LatestControlRequest }
  | { kind: "no_request_recorded" };

const field = (data: unknown, key: string): unknown =>
  typeof data === "object" && data !== null ? (data as Record<string, unknown>)[key] : undefined;

/** The last request in the log, or nothing when the conversation never asked. */
export function pickLatestControlRequest(
  events: readonly ControlRequestHistoryEvent[],
): LatestControlRequestReading {
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
  return latest ? { kind: "recorded", request: latest } : { kind: "no_request_recorded" };
}

/**
 * The latest request's one state: Redis's open request first, else the log. An approval spends the
 * request before the folder connects, so for that moment it still reads as open.
 */
export function controlRequestState({
  open,
  latest,
  claimed,
  connected,
  now,
}: {
  open: { expiresAt: number } | null;
  latest: LatestControlRequestReading;
  claimed: boolean;
  /** A folder is connected to the conversation right now. */
  connected: boolean;
  now: number;
}): ControlRequestState {
  if (connected) return "approved";
  if (open && open.expiresAt > now) return "open";
  if (open) return "expired";
  if (latest.kind === "no_request_recorded") return "none";
  if (latest.request.approved) return "ended";
  if (latest.request.expiresAt <= now) return "expired";
  return claimed ? "open" : "declined";
}
