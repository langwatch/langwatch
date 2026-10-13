import type { StoredLocalCall } from "../rules/langy-local-call-record.rules.ts";

/** A read of one stored record: written and readable, written but unreadable, or absent. */
export type LocalRecordLookup<T> =
  | { kind: "hit"; value: T }
  | { kind: "unreadable"; reasons: Error[] }
  | { kind: "miss" };

/**
 * The local tool calls in flight (ADR-129): each call's record, the pending
 * set of each conversation scored by expiry, and the keepalive window that
 * lets one replica write one activity line. Every write carries its expiry.
 */
export abstract class LangyLocalCallRepository {
  /** Writes the call's record, replacing what was there. */
  abstract save(input: { call: StoredLocalCall; ttlSeconds: number }): Promise<void>;

  /** The call's record; `miss` once it has expired. */
  abstract find(callId: string): Promise<LocalRecordLookup<StoredLocalCall>>;

  /** Puts the call in its conversation's pending set, scored by when it stops mattering. */
  abstract trackPending(input: {
    conversationId: string;
    callId: string;
    expiresAt: number;
    ttlSeconds: number;
  }): Promise<void>;

  abstract untrackPending(input: { conversationId: string; callId: string }): Promise<void>;

  /** Drops every pending call scored at or before `lapsedAt`. */
  abstract dropLapsedPending(input: { conversationId: string; lapsedAt: number }): Promise<void>;

  /** The pending call ids scored at or after `from`, soonest first. */
  abstract findPendingIds(input: { conversationId: string; from: number }): Promise<string[]>;

  /** Opens the call's keepalive window; false when another replica already holds it. */
  abstract claimKeepaliveWindow(input: {
    callId: string;
    at: number;
    ttlSeconds: number;
  }): Promise<boolean>;
}
