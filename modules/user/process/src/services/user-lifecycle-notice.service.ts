import type { LedgerActor } from "@langwatch/authorization";
import type { EventingCommandSender } from "@langwatch/eventing";
import type { Instant } from "@langwatch/time";

import type {
  RecordUserCreatedCommandData,
  RecordUserLifecycleCommandData,
  RecordUserRegisteredCommandData,
} from "../eventing/user-lifecycle.events.ts";
import type { UserFactIntent } from "../rules/user-lifecycle-outbox.rules.ts";

type Change = { userId: string; actor: LedgerActor; at: Instant };

export type UserLifecycleSenders = Readonly<{
  recordUserDeactivated: Pick<
    EventingCommandSender<RecordUserLifecycleCommandData>,
    "send" | "sendBatch"
  >;
  recordUserReactivated: Pick<
    EventingCommandSender<RecordUserLifecycleCommandData>,
    "send" | "sendBatch"
  >;
  recordUserRegistered: Pick<EventingCommandSender<RecordUserRegisteredCommandData>, "send">;
  recordUserCreated: Pick<
    EventingCommandSender<RecordUserCreatedCommandData>,
    "send" | "sendBatch"
  >;
  recordUserErased: Pick<EventingCommandSender<RecordUserLifecycleCommandData>, "send">;
}>;

/**
 * Where user's facts are sent on user_lifecycle; peers keep their own view from them (§9). A
 * deactivation or reactivation fails its request when unsent; a mint's, registration's and
 * erasure's facts arrive through the fact outbox (round 35). Senders arrive once it registers.
 */
export class UserLifecycleNoticeService {
  static create(): UserLifecycleNoticeService {
    return new UserLifecycleNoticeService();
  }

  #senders: UserLifecycleSenders | undefined;

  private constructor() {}

  connect(senders: UserLifecycleSenders): void {
    this.#senders = senders;
  }

  async deactivated({ userId, actor, at }: Change): Promise<void> {
    await this.#connected().recordUserDeactivated.send(this.#data({ userId, actor, at }));
  }

  async reactivated({ userId, actor, at }: Change): Promise<void> {
    await this.#connected().recordUserReactivated.send(this.#data({ userId, actor, at }));
  }

  /** Every account, however minted; `backfilled` when the seed step records an older one. */
  async created({
    userId,
    at,
    backfilled,
  }: {
    userId: string;
    at: Instant;
    backfilled?: true;
  }): Promise<void> {
    await this.#connected().recordUserCreated.send({
      tenantId: userId,
      userId,
      occurredAt: at.epochMilliseconds,
      ...(backfilled ? { backfilled } : {}),
    });
  }

  /**
   * One backfill page: every created fact, then the page's deactivations and reactivations, so
   * an account's created fact is sent before its standing. Each kind goes as one batch.
   */
  async recordBackfillPage({
    created,
    deactivated,
    reactivated,
    actor,
  }: {
    created: readonly { userId: string; at: Instant }[];
    deactivated: readonly { userId: string; at: Instant }[];
    reactivated: readonly { userId: string; at: Instant }[];
    actor: LedgerActor;
  }): Promise<void> {
    const senders = this.#connected();
    if (created.length > 0) {
      await senders.recordUserCreated.sendBatch(
        created.map(({ userId, at }) => ({
          tenantId: userId,
          userId,
          occurredAt: at.epochMilliseconds,
          backfilled: true,
        })),
      );
    }
    if (deactivated.length > 0) {
      await senders.recordUserDeactivated.sendBatch(
        deactivated.map(({ userId, at }) => this.#data({ userId, actor, at })),
      );
    }
    if (reactivated.length > 0) {
      await senders.recordUserReactivated.sendBatch(
        reactivated.map(({ userId, at }) => this.#data({ userId, actor, at })),
      );
    }
  }

  /**
   * The fact outbox's delivery: a fact its write committed, recorded under the key the write
   * minted. Unconnected throws, so the outbox retries it.
   */
  async record(intent: UserFactIntent): Promise<void> {
    const senders = this.#connected();
    switch (intent.type) {
      case "recordCreated":
        return senders.recordUserCreated.send(intent.data);
      case "recordRegistered":
        return senders.recordUserRegistered.send(intent.data);
      case "recordErased":
        return senders.recordUserErased.send(intent.data);
    }
  }

  #connected(): UserLifecycleSenders {
    if (!this.#senders) throw new Error("user_lifecycle is not registered in this process");
    return this.#senders;
  }

  #data({ userId, actor, at }: Change): RecordUserLifecycleCommandData {
    return { tenantId: userId, userId, occurredAt: at.epochMilliseconds, actor };
  }
}
