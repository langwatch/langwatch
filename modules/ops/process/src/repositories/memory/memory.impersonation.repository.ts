import { UserToImpersonateNotFoundError } from "@langwatch/ops-contract";

import { ImpersonationRepository, type ImpersonationTarget } from "../impersonation.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

/** Who may be impersonated and who holds a second factor, in memory. */
export class MemoryImpersonationRepository extends ImpersonationRepository {
  static create({ store }: { store: MemoryOpsStore }): MemoryImpersonationRepository {
    return new MemoryImpersonationRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async getTarget(userId: string): Promise<ImpersonationTarget> {
    const target = this.store.impersonationTargets.get(userId);
    if (!target) throw new UserToImpersonateNotFoundError(userId);
    return target;
  }

  async hasSecondFactor(userId: string): Promise<boolean> {
    return this.store.secondFactorUserIds.has(userId);
  }
}
