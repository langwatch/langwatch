import { isPlatformOperatorEmail } from "../../rules/platform-operator.rules.ts";
import type { SsoPlatformOperatorRepository } from "../sso-connection.repository.ts";
import type { MemoryIdentityStore } from "./memory.identity.store.ts";

/** Whether an actor's address is on the deployment's operator list, over the memory users. */
export class MemorySsoPlatformOperatorsRepository implements SsoPlatformOperatorRepository {
  static create(options: {
    store: MemoryIdentityStore;
    adminEmails: readonly string[];
  }): MemorySsoPlatformOperatorsRepository {
    return new MemorySsoPlatformOperatorsRepository(options.store, options.adminEmails);
  }

  private constructor(
    private readonly store: MemoryIdentityStore,
    private readonly adminEmails: readonly string[],
  ) {}

  async isPlatformOperator({ actorId }: { actorId: string }): Promise<boolean> {
    const user = this.store.users.get(actorId);
    if (!user) return false;
    return isPlatformOperatorEmail({ adminEmails: this.adminEmails, email: user.email });
  }
}
