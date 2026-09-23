import {
  ownedVerifiedDomains,
  verifiedDomainCanBeShared,
} from "../../rules/sso-domain-ownership.rules.ts";
import { SsoDomainOwnershipRepository } from "../sso-domain-ownership.repository.ts";
import type { MemoryIdentityStore } from "./memory.identity.store.ts";

/**
 * The memory tier derives ownership from the heads, so there is nothing to
 * write; it refuses exactly where the Postgres twin's constraints would.
 */
export class MemorySsoDomainOwnershipRepository extends SsoDomainOwnershipRepository {
  static create(store: MemoryIdentityStore): MemorySsoDomainOwnershipRepository {
    return new MemorySsoDomainOwnershipRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {
    super();
  }

  async findConnectionIds({ organizationId }: { organizationId: string }): Promise<string[]> {
    return [...this.store.ssoConnections.values()]
      .filter((connection) => connection.organizationId === organizationId)
      .map((connection) => connection.connectionId);
  }

  async reproject({ connectionId }: { connectionId: string }): Promise<void> {
    const incoming = this.store.ssoConnections.get(connectionId);
    if (!incoming) return;
    for (const domain of ownedVerifiedDomains(incoming)) {
      const holder = [...this.store.ssoConnections.values()].find(
        (existing) =>
          existing.connectionId !== connectionId && ownedVerifiedDomains(existing).includes(domain),
      );
      if (
        holder &&
        !verifiedDomainCanBeShared({
          existing: { ...holder, id: holder.connectionId },
          incoming: { ...incoming, id: incoming.connectionId },
        })
      ) {
        throw new Error(
          `sso_domain_owned_elsewhere: ${connectionId} folded ${domain}, already held by ${holder.connectionId}`,
        );
      }
    }
  }
}
