import type { StoredUserWait } from "../rules/langy-local-user-wait-record.rules.ts";
import type { LocalRecordLookup } from "./langy-local-call.repository.ts";

/**
 * The permission and question cards on screen (ADR-129): each wait's record,
 * and the pending set of each turn scored by expiry. Every write carries its
 * expiry.
 */
export abstract class LangyLocalUserWaitRepository {
  /** Writes the wait's record, replacing what was there. */
  abstract save(input: { wait: StoredUserWait; ttlSeconds: number }): Promise<void>;

  /** The wait's record; `miss` once it has expired. */
  abstract find(waitId: string): Promise<LocalRecordLookup<StoredUserWait>>;

  /** Puts the wait in its turn's pending set, scored by its expiry. */
  abstract trackPending(input: {
    conversationId: string;
    turnId: string;
    waitId: string;
    expiresAt: number;
    ttlSeconds: number;
  }): Promise<void>;

  abstract untrackPending(input: {
    conversationId: string;
    turnId: string;
    waitId: string;
  }): Promise<void>;

  /** Every wait id in the turn's pending set, soonest expiry first. */
  abstract findPendingIds(input: { conversationId: string; turnId: string }): Promise<string[]>;
}
