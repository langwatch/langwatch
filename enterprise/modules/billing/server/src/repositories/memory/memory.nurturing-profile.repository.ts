// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { NurturingProfileRepository, type NurturingProfile } from "../nurturing-profile.repository.ts";
import type { MemoryBillingStore } from "./memory-billing.store.ts";

/** The lifecycle-signal reads, answered from the seats the store holds. */
export class MemoryNurturingProfileRepository extends NurturingProfileRepository {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryNurturingProfileRepository {
    return new MemoryNurturingProfileRepository(store);
  }

  async tryFindProfile(userId: string): Promise<NurturingProfile | null> {
    return this.store.profileOf(userId);
  }

  async memberUserIds(organizationId: string): Promise<string[]> {
    return [...this.store.users.values()]
      .filter((user) => user.organizationId === organizationId)
      .map((user) => user.id);
  }
}
