import type { LookupOperatorActivityRow } from "@langwatch/identity-contract";

import {
  type IdentityLookupRepository,
  type LookupConnectionRow,
  type LookupIdentifierRow,
  type LookupInvitationRow,
  type LookupMembershipRow,
  type LookupUserRow,
} from "../identity-lookup.repository.ts";
import type { MemoryIdentityStore } from "./memory-identity.store.ts";

/**
 * The lookup twin. Identifiers and connections come off the shared store;
 * names, memberships, invitations and activity have no shared-store home
 * yet, so whatever composes this repository seeds them directly.
 */
export class MemoryIdentityLookupRepository implements IdentityLookupRepository {
  static create(store: MemoryIdentityStore): MemoryIdentityLookupRepository {
    return new MemoryIdentityLookupRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {}

  readonly users = new Map<string, LookupUserRow>();
  readonly memberships = new Map<string, LookupMembershipRow[]>();
  readonly invitations: LookupInvitationRow[] = [];
  readonly activity: LookupOperatorActivityRow[] = [];

  /** Pushed to by whatever bridges the audit-log write port in tests. */
  record(row: LookupOperatorActivityRow): void {
    this.activity.unshift(row);
  }

  async findIdentifiersByValue({
    value,
  }: {
    value: string;
  }): Promise<readonly LookupIdentifierRow[]> {
    return [...this.store.identifiers.values()].filter((fact) => fact.value === value);
  }

  async findIdentifiersForUser({
    userId,
  }: {
    userId: string;
  }): Promise<readonly LookupIdentifierRow[]> {
    return [...this.store.identifiers.values()].filter((fact) => fact.userId === userId);
  }

  async findUsers({ userIds }: { userIds: readonly string[] }): Promise<readonly LookupUserRow[]> {
    return userIds.flatMap((userId) => {
      const seeded = this.users.get(userId);
      if (seeded) return [seeded];
      const row = this.store.users.get(userId);
      return row ? [{ userId: row.id, name: null, email: row.email }] : [];
    });
  }

  async findMemberships({
    userIds,
  }: {
    userIds: readonly string[];
  }): Promise<readonly LookupMembershipRow[]> {
    return userIds.flatMap((userId) => this.memberships.get(userId) ?? []);
  }

  async findInvitations({ email }: { email: string }): Promise<readonly LookupInvitationRow[]> {
    const target = email.toLowerCase();
    return this.invitations.filter((row) => row.email.toLowerCase() === target);
  }

  async findConnectionForDomain({
    domain,
  }: {
    domain: string;
  }): Promise<LookupConnectionRow | null> {
    const connection = [...this.store.ssoConnections.values()].find((row) =>
      row.verifiedDomains.includes(domain),
    );
    if (!connection) return null;
    return {
      connectionId: connection.connectionId,
      organizationId: connection.organizationId,
      organizationName: this.store.organizationNames.get(connection.organizationId) ?? null,
      state: connection.state,
      providerId: connection.idpMetadata.providerId,
    };
  }

  async findRecentOperatorActivity({
    limit,
  }: {
    limit: number;
  }): Promise<readonly LookupOperatorActivityRow[]> {
    return this.activity.slice(0, limit);
  }
}
