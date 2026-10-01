import type { EventingCommandSender } from "@langwatch/eventing";
import type { Instant } from "@langwatch/time";
import type { UserLedgerActor } from "@langwatch/user-contract";

import type { RecordUserLifecycleCommandData } from "../eventing/user-lifecycle.events.ts";

type Change = { userId: string; actor: UserLedgerActor; at: Instant };

export type UserLifecycleSenders = Readonly<{
  recordUserDeactivated: Pick<EventingCommandSender<RecordUserLifecycleCommandData>, "send">;
  recordUserReactivated: Pick<EventingCommandSender<RecordUserLifecycleCommandData>, "send">;
}>;

/**
 * Where an account's deactivation and reactivation are recorded as user's facts; authz keeps who
 * may still act from them (§9). Not best effort: a change peers never hear of fails the request,
 * and a retry records the same change again. The senders arrive once the pipeline registers.
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

  #connected(): UserLifecycleSenders {
    if (!this.#senders) throw new Error("user_lifecycle is not registered in this process");
    return this.#senders;
  }

  #data({ userId, actor, at }: Change): RecordUserLifecycleCommandData {
    return { tenantId: userId, userId, occurredAt: at.epochMilliseconds, actor };
  }
}
