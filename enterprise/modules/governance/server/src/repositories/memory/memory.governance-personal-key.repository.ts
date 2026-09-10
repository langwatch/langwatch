// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PersonalVirtualKey } from "@langwatch/enterprise-governance-contract";
import { PersonalVirtualKeyRepository } from "../../ports/personal-virtual-key.port.ts";
import type { MemoryGovernanceStore } from "./memory-governance.store.ts";

/** A key still usable: not revoked, and owned by a person rather than a project. */
function isActive(key: PersonalVirtualKey): boolean {
  return key.status !== "revoked";
}

/** The personal-virtual-key twin: the member's own keys, from the shared store. */
export class MemoryPersonalVirtualKeyRepository extends PersonalVirtualKeyRepository {
  private constructor(private readonly store: MemoryGovernanceStore) {
    super();
  }

  static create(store: MemoryGovernanceStore): MemoryPersonalVirtualKeyRepository {
    return new MemoryPersonalVirtualKeyRepository(store);
  }

  async tryFindDefault(input: {
    userId: string;
    organizationId: string;
    personalProjectId: string;
  }): Promise<PersonalVirtualKey | null> {
    return (
      this.store.personalVirtualKeys.find(
        (key) =>
          isActive(key) &&
          key.principalUserId === input.userId &&
          key.organizationId === input.organizationId,
      ) ?? null
    );
  }

  async list(input: { organizationId: string; userId?: string }): Promise<PersonalVirtualKey[]> {
    return this.store.personalVirtualKeys.filter(
      (key) =>
        key.organizationId === input.organizationId &&
        (input.userId === undefined || key.principalUserId === input.userId),
    );
  }

  async tryFindOwned(input: {
    id: string;
    organizationId: string;
    userId: string;
  }): Promise<PersonalVirtualKey | null> {
    return (
      this.store.personalVirtualKeys.find(
        (key) =>
          key.id === input.id &&
          key.organizationId === input.organizationId &&
          key.principalUserId === input.userId,
      ) ?? null
    );
  }

  async listActiveForUser(userId: string): Promise<PersonalVirtualKey[]> {
    return this.store.personalVirtualKeys.filter(
      (key) => isActive(key) && key.principalUserId === userId,
    );
  }

  async countEligibleProviders(input: {
    organizationId: string;
    personalTeamId?: string;
    personalProjectId: string;
  }): Promise<number> {
    return this.store.eligibleProviderIds.get(input.organizationId)?.length ?? 0;
  }
}
