import type { EventingCommandSender } from "@langwatch/eventing";
import type { Instant } from "@langwatch/time";

import type { RecordUserLifecycleCommandData } from "../eventing/user-lifecycle.events.ts";

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

  async deactivated({ userId, at }: { userId: string; at: Instant }): Promise<void> {
    await this.#connected().recordUserDeactivated.send(this.#data({ userId, at }));
  }

  async reactivated({ userId, at }: { userId: string; at: Instant }): Promise<void> {
    await this.#connected().recordUserReactivated.send(this.#data({ userId, at }));
  }

  #connected(): UserLifecycleSenders {
    if (!this.#senders) throw new Error("user_lifecycle is not registered in this process");
    return this.#senders;
  }

  #data({ userId, at }: { userId: string; at: Instant }): RecordUserLifecycleCommandData {
    return { tenantId: userId, userId, occurredAt: at.epochMilliseconds };
  }
}
