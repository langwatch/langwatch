import { reproofTargetsOf } from "../../rules/sso-domain-reproof-targets.rules.ts";
import type {
  SsoDomainReproofTarget,
  SsoDomainReproofTargetRepository,
} from "../sso-domain-reproof.repository.ts";
import type { MemoryIdentityStore } from "./memory-identity.store.ts";

const REPROOF_STATES = ["VERIFIED", "ACTIVE"];

/** The rotation twin: the same order, over the store's folded connections. */
export class MemorySsoDomainReproofTargetRepository implements SsoDomainReproofTargetRepository {
  static create(store: MemoryIdentityStore): MemorySsoDomainReproofTargetRepository {
    return new MemorySsoDomainReproofTargetRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async findDomainsProvedByRecord({ limit }: { limit: number }): Promise<SsoDomainReproofTarget[]> {
    const proved = [...this.store.ssoConnections.values()].filter(
      (connection) =>
        REPROOF_STATES.includes(connection.state) && connection.verifiedDomains.length > 0,
    );
    const ordered = proved.toSorted((left, right) => {
      const lookedAt =
        (this.store.ssoReproofCursors.get(left.connectionId) ?? -1) -
        (this.store.ssoReproofCursors.get(right.connectionId) ?? -1);

      return lookedAt === 0 ? left.connectionId.localeCompare(right.connectionId) : lookedAt;
    });

    return ordered.slice(0, limit).flatMap((connection) =>
      reproofTargetsOf({
        connectionId: connection.connectionId,
        organizationId: connection.organizationId,
        verifiedDomains: connection.verifiedDomains,
        domainVerifications: connection.domainVerifications,
      }),
    );
  }

  async markSwept({
    connectionIds,
    atMs,
  }: {
    connectionIds: readonly string[];
    atMs: number;
  }): Promise<void> {
    for (const connectionId of connectionIds) {
      const looked = this.store.ssoReproofCursors.get(connectionId) ?? 0;
      this.store.ssoReproofCursors.set(connectionId, Math.max(looked, atMs));
    }
  }
}
