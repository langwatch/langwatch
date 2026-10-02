import {
  CALL_ENVELOPE_SLACK_MS,
  CALL_RESULT_TTL_MS,
  PERMISSION_WAIT_BUDGET_MS,
} from "@langwatch/langy-contract";
import type { SessionStateStore } from "@langwatch/redis-client/session-state";

import type { StoredLocalCall } from "../rules/langy-local-call-record.rules.ts";
import { callKey, pendingCallsKey } from "../rules/langy-local-control-keys.rules.ts";

/** Writes one local call's record and keeps the pending set in step with its expiry. */
export class LocalCallStoreService {
  private readonly store: SessionStateStore;
  private readonly now: () => number;

  static create({
    store,
    now,
  }: {
    store: SessionStateStore;
    now: () => number;
  }): LocalCallStoreService {
    return new LocalCallStoreService({ store, now });
  }

  private constructor({ store, now }: { store: SessionStateStore; now: () => number }) {
    this.store = store;
    this.now = now;
  }

  async settle(call: StoredLocalCall): Promise<StoredLocalCall> {
    const done: StoredLocalCall = { ...call, state: "done" };
    await this.store.set(
      callKey(done.callId),
      JSON.stringify(done),
      Math.ceil(CALL_RESULT_TTL_MS / 1000),
    );
    await this.store.zrem(pendingCallsKey(done.conversationId), done.callId);

    return done;
  }

  async write(call: StoredLocalCall): Promise<void> {
    await this.store.set(callKey(call.callId), JSON.stringify(call), this.envelopeTtlSeconds(call));
  }

  /** Keeps the conversation's pending set in step with the call's own expiry. */
  async track(call: StoredLocalCall): Promise<void> {
    await this.store.zadd({
      key: pendingCallsKey(call.conversationId),
      score: this.expiresAt(call),
      member: call.callId,
      ttlSeconds: this.envelopeTtlSeconds(call),
    });
  }

  /**
   * When the envelope stops being worth keeping. A call waiting on a card
   * lives for the card's whole budget: the developer has that long to answer,
   * and the call has to be there when they do.
   */
  private expiresAt(call: StoredLocalCall): number {
    if (call.state !== "awaiting_permission") {
      return call.deadlineAt;
    }

    return Math.max(call.deadlineAt, this.now() + PERMISSION_WAIT_BUDGET_MS);
  }

  private envelopeTtlSeconds(call: StoredLocalCall): number {
    const remaining = this.expiresAt(call) - this.now() + CALL_ENVELOPE_SLACK_MS;

    return Math.max(1, Math.ceil(remaining / 1000));
  }
}
