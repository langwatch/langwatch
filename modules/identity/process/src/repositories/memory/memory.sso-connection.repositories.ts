import { SsoConnectionNotFoundError, type SsoConnectionState } from "@langwatch/identity-contract";

import { ownedVerifiedDomains } from "../../rules/sso-domain-ownership.rules.ts";
import type {
  SsoConnectionBackofficePage,
  SsoConnectionBackofficeRepository,
} from "../sso-connection-backoffice.repository.ts";
import type {
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
} from "../sso-connection.repository.ts";
import type { MemoryIdentityStore } from "./memory.identity.store.ts";

const VERIFIED = "VERIFIED";

/** The connection-read twin: the guards' folded head and the domain owner. */
export class MemorySsoConnectionReadRepository implements SsoConnectionReadRepository {
  static create(store: MemoryIdentityStore): MemorySsoConnectionReadRepository {
    return new MemorySsoConnectionReadRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async getConnection(args: { connectionId: string }): Promise<SsoConnectionState> {
    const connection = this.store.ssoConnections.get(args.connectionId);
    if (!connection) {
      throw new SsoConnectionNotFoundError(`connection ${args.connectionId} does not exist`);
    }
    return connection;
  }

  async getDomainOwner(args: {
    domain: string;
  }): Promise<{ connectionId: string; organizationId: string }> {
    // The Postgres twin reads the ownership rows the projection keeps; the
    // same rule derives them here, predecessor first.
    const holders = [...this.store.ssoConnections.values()].filter((connection) =>
      ownedVerifiedDomains(connection).includes(args.domain),
    );
    const owner =
      holders.find((connection) => connection.replacesConnectionId === null) ?? holders[0];

    if (!owner) {
      throw new SsoConnectionNotFoundError(`no live connection holds domain ${args.domain}`);
    }
    return { connectionId: owner.connectionId, organizationId: owner.organizationId };
  }

  async findForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SsoConnectionState[]> {
    return [...this.store.ssoConnections.values()]
      .filter((connection) => connection.organizationId === organizationId)
      .toSorted((left, right) => right.createdAtMs - left.createdAtMs);
  }
}

/** The stranding twin: users whose only live identifiers hang off one connection. */
export class MemorySsoConnectionStrandingRepository implements SsoConnectionStrandingRepository {
  static create(store: MemoryIdentityStore): MemorySsoConnectionStrandingRepository {
    return new MemorySsoConnectionStrandingRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async findStrandedUserIds(args: { connectionId: string }): Promise<string[]> {
    const live = [...this.store.identifiers.values()].filter(
      (fact) => fact.state === VERIFIED || fact.state === "PRIMARY",
    );

    const byUser = new Map<string, typeof live>();
    for (const fact of live) {
      byUser.set(fact.userId, [...(byUser.get(fact.userId) ?? []), fact]);
    }

    return [...byUser.entries()]
      .filter(([, facts]) => facts.every((fact) => fact.connectionId === args.connectionId))
      .map(([userId]) => userId);
  }
}

/** The backoffice twin: one page over every connection the store holds. */
export class MemorySsoConnectionBackofficeRepository implements SsoConnectionBackofficeRepository {
  static create(store: MemoryIdentityStore): MemorySsoConnectionBackofficeRepository {
    return new MemorySsoConnectionBackofficeRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async listPage(args: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<SsoConnectionBackofficePage> {
    const search = args.search?.toLowerCase() ?? "";
    const matched = [...this.store.ssoConnections.values()].filter(
      (connection) => search === "" || connection.connectionId.toLowerCase().includes(search),
    );
    const start = Math.max(0, args.page - 1) * args.pageSize;

    return { states: matched.slice(start, start + args.pageSize), total: matched.length };
  }

  async getById(args: { connectionId: string }): Promise<SsoConnectionState> {
    const connection = this.store.ssoConnections.get(args.connectionId);
    if (!connection) throw new SsoConnectionNotFoundError(`no connection ${args.connectionId}`);
    return connection;
  }

  async findOrganizationNames(args: { organizationIds: string[] }): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const organizationId of args.organizationIds) {
      const name = this.store.organizationNames.get(organizationId);
      if (name !== undefined) names.set(organizationId, name);
    }

    return names;
  }
}
