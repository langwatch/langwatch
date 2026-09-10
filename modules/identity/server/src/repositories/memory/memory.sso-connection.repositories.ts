import type { SsoConnectionState } from "@langwatch/identity-contract";
import type {
  SsoConnectionBackofficePage,
  SsoConnectionBackofficeRepository,
} from "../sso-connection-backoffice.repository.ts";
import type {
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
} from "../sso-connection.repository.ts";
import { MemoryIdentityStore } from "./memory-identity.store.ts";

const VERIFIED = "VERIFIED";
const ACTIVE = "ACTIVE";

/** The connection-read twin: the guards' folded head and the domain owner. */
export class MemorySsoConnectionReadRepository implements SsoConnectionReadRepository {
  static create(store: MemoryIdentityStore): MemorySsoConnectionReadRepository {
    return new MemorySsoConnectionReadRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  async tryFindConnection(args: { connectionId: string }): Promise<SsoConnectionState | null> {
    return this.store.ssoConnections.get(args.connectionId) ?? null;
  }

  async tryFindDomainOwner(args: {
    domain: string;
  }): Promise<{ connectionId: string; organizationId: string } | null> {
    const owner = [...this.store.ssoConnections.values()].find(
      (connection) =>
        connection.state === ACTIVE && this.verifiedDomains(connection).includes(args.domain),
    );

    return owner ? { connectionId: owner.connectionId, organizationId: owner.organizationId } : null;
  }

  private verifiedDomains(connection: SsoConnectionState): readonly string[] {
    const domains = Reflect.get(connection, "verifiedDomains");

    return Array.isArray(domains) ? domains.filter((value) => typeof value === "string") : [];
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

  async findPage(args: {
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

  async tryFindById(args: { connectionId: string }): Promise<SsoConnectionState | null> {
    return this.store.ssoConnections.get(args.connectionId) ?? null;
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
