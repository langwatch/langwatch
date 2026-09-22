import { isLiveIdentifierState } from "@langwatch/identity-contract";

import type {
  MigrationIdentifierHolding,
  SsoAuthenticationRecord,
  SsoMigrationEvidenceRepository,
} from "../sso-migration-evidence.repository.ts";
import type { MemoryIdentityStore } from "./memory-identity.store.ts";

/** The same evidence over the store's identifier and activity rows. */
export class MemorySsoMigrationEvidenceRepository implements SsoMigrationEvidenceRepository {
  static create(store: MemoryIdentityStore): MemorySsoMigrationEvidenceRepository {
    return new MemorySsoMigrationEvidenceRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async recordAuthentication(record: SsoAuthenticationRecord): Promise<void> {
    this.store.ssoAuthentications.push({ ...record });
  }

  async findLiveIdentifierHoldings({
    userIds,
  }: {
    userIds: string[];
  }): Promise<MigrationIdentifierHolding[]> {
    const wanted = new Set(userIds);

    return [...this.store.identifiers.values()]
      .filter((fact) => wanted.has(fact.userId) && isLiveIdentifierState(fact.state))
      .map((fact) => ({
        userId: fact.userId,
        state: fact.state,
        connectionId: fact.connectionId,
        providerId: fact.providerId,
        providerAccountId: fact.providerAccountId,
      }));
  }

  async findLastAuthenticationAtMs({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<number | null> {
    const times = this.store.ssoAuthentications
      .filter((row) => row.organizationId === organizationId && row.connectionId === connectionId)
      .map((row) => row.authenticatedAtMs);

    return times.length === 0 ? null : Math.max(...times);
  }

  async findLastAuthenticationByUser({
    organizationId,
    connectionId,
    userIds,
  }: {
    organizationId: string;
    connectionId: string;
    userIds: string[];
  }): Promise<Map<string, number>> {
    const wanted = new Set(userIds);
    const latest = new Map<string, number>();
    for (const row of this.store.ssoAuthentications) {
      if (row.organizationId !== organizationId || row.connectionId !== connectionId) continue;
      if (!wanted.has(row.userId)) continue;
      const held = latest.get(row.userId);
      if (held === undefined || held < row.authenticatedAtMs) {
        latest.set(row.userId, row.authenticatedAtMs);
      }
    }

    return latest;
  }
}
