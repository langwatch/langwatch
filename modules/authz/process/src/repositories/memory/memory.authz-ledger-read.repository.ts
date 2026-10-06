import { OffboardIncompleteError } from "@langwatch/authz-contract";
import type { Instant } from "@langwatch/time";

import {
  AuthzLedgerReadRepository,
  type LedgerDirectoryGrantRow,
  type LedgerGrantIdentity,
  type LedgerRoleDefinition,
} from "../authz-ledger-read.repository.ts";
import type { AuthzReadRepository } from "../authz-read.repository.ts";
import type { GrantRowShape } from "../prisma/prisma.authz-grant.mapper.ts";
import type { AuthzGrantFilter } from "../prisma/prisma.authz-ledger.mapper.ts";
import type { AuthzMemoryGrantRow, AuthzMemoryStore } from "./authz-memory.store.ts";
import { MemoryAuthzReadRepository } from "./memory.authz-read.repository.ts";

const msOf = (instant: Instant): number => instant.epochMilliseconds;

/** One filter value, in the shapes the compat-filter translation produces: value, `in`, `not`. */
function matchesValue({ actual, expected }: { actual: unknown; expected: unknown }): boolean {
  if (expected === null || typeof expected !== "object") return actual === expected;
  if ("in" in expected && Array.isArray(expected.in)) return expected.in.includes(actual);
  if ("not" in expected) return actual !== expected.not;
  throw new Error(`The memory Grant head cannot express the filter ${JSON.stringify(expected)}`);
}

function matchesFilter({ row, where }: { row: AuthzMemoryGrantRow; where: AuthzGrantFilter }) {
  return Object.entries(where).every(([column, expected]) =>
    matchesValue({ actual: row[column as keyof AuthzMemoryGrantRow], expected }),
  );
}

function sameIdentity({ row, identity }: { row: GrantRowShape; identity: LedgerGrantIdentity }) {
  return (
    row.principalType === identity.principalType &&
    row.principalId === identity.principalId &&
    row.roleKey === identity.roleKey &&
    row.scopeType === identity.scopeType &&
    row.scopeId === identity.scopeId
  );
}

function grantShape(row: AuthzMemoryGrantRow): GrantRowShape {
  const {
    revokedAt: _revokedAt,
    revokedReason: _reason,
    updatedAt: _at,
    createdAt: _c,
    ...shape
  } = row;
  return shape;
}

function directoryRow(row: AuthzMemoryGrantRow): LedgerDirectoryGrantRow {
  return {
    id: row.id,
    principalId: row.principalId,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

/** The ledger's reads over the memory Grant and Role heads, with the Prisma queries' filters. */
export class MemoryAuthzLedgerReadRepository extends AuthzLedgerReadRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzLedgerReadRepository {
    return new MemoryAuthzLedgerReadRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  private liveGrants(): AuthzMemoryGrantRow[] {
    return this.memory.grants.filter((row) => row.revokedAt === null);
  }

  private liveRole({ roleId, organizationId }: { roleId: string; organizationId?: string }) {
    return this.memory.roleHeads.find(
      (row) =>
        row.id === roleId &&
        row.deletedAt === null &&
        (organizationId === undefined || row.organizationId === organizationId),
    );
  }

  async countLandedGrants({
    organizationId,
    grants,
    occurredSince,
  }: {
    organizationId: string;
    grants: readonly (LedgerGrantIdentity & { id: string })[];
    occurredSince: Instant;
  }): Promise<number> {
    return this.liveGrants().filter(
      (row) =>
        row.organizationId === organizationId &&
        msOf(row.occurredAt) >= msOf(occurredSince) &&
        grants.some((grant) => grant.id === row.id && sameIdentity({ row, identity: grant })),
    ).length;
  }

  async findLiveGrantsByIdentity({
    organizationId,
    identities,
  }: {
    organizationId: string;
    identities: readonly LedgerGrantIdentity[];
  }): Promise<GrantRowShape[]> {
    return this.liveGrants()
      .filter(
        (row) =>
          row.organizationId === organizationId &&
          identities.some((identity) => sameIdentity({ row, identity })),
      )
      .map(grantShape);
  }

  async findLiveGrant({
    grantId,
    organizationId,
  }: {
    grantId: string;
    organizationId?: string;
  }): Promise<GrantRowShape | null> {
    const row = this.liveGrants().find(
      (candidate) =>
        candidate.id === grantId &&
        (organizationId === undefined || candidate.organizationId === organizationId),
    );
    return row ? grantShape(row) : null;
  }

  async findLiveGrantRoleKey({
    grantId,
    organizationId,
  }: {
    grantId: string;
    organizationId: string;
  }): Promise<{ roleKey: string | null } | null> {
    const row = await this.findLiveGrant({ grantId, organizationId });
    return row ? { roleKey: row.roleKey } : null;
  }

  async hasLiveGrant({
    grantId,
    organizationId,
    scopeType,
    projectId,
  }: {
    grantId: string;
    organizationId: string;
    scopeType: "RESOURCE" | "PLATFORM";
    projectId?: string;
  }): Promise<boolean> {
    return this.liveGrants().some(
      (row) =>
        row.id === grantId &&
        row.organizationId === organizationId &&
        row.scopeType === scopeType &&
        (projectId === undefined || row.projectId === projectId),
    );
  }

  async findLiveGrantIds({ where }: { where: AuthzGrantFilter }): Promise<string[]> {
    return this.liveGrants()
      .filter((row) => matchesFilter({ row, where }))
      .map((row) => row.id);
  }

  async findLiveRole({
    roleId,
    organizationId,
  }: {
    roleId: string;
    organizationId: string;
  }): Promise<LedgerRoleDefinition | null> {
    const row = this.liveRole({ roleId, organizationId });
    return row
      ? { name: row.name, description: row.description, permissions: [...row.permissions] }
      : null;
  }

  async hasLiveRole({
    roleId,
    organizationId,
  }: {
    roleId: string;
    organizationId: string;
  }): Promise<boolean> {
    return this.liveRole({ roleId, organizationId }) !== undefined;
  }

  async findLiveCustomRole({
    roleId,
  }: {
    roleId: string;
  }): Promise<{ organizationId: string; permissions: unknown } | null> {
    const row = this.liveRole({ roleId });
    return row ? { organizationId: row.organizationId, permissions: [...row.permissions] } : null;
  }

  private directoryGrants(organizationId: string): AuthzMemoryGrantRow[] {
    return this.memory.grants.filter(
      (row) =>
        row.organizationId === organizationId &&
        row.principalType === "USER" &&
        row.scopeType === "ORGANIZATION" &&
        row.scopeId === organizationId &&
        row.source === "scim",
    );
  }

  async findDirectoryGrantIds({
    organizationId,
    userIds,
  }: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<string[]> {
    return this.directoryGrants(organizationId)
      .filter(
        (row) =>
          row.revokedAt === null && row.principalId !== null && userIds.includes(row.principalId),
      )
      .map((row) => row.id);
  }

  async findDirectoryGrantHistory({
    organizationId,
    limit,
  }: {
    organizationId: string;
    limit: number;
  }): Promise<{ attached: LedgerDirectoryGrantRow[]; removed: LedgerDirectoryGrantRow[] }> {
    const rows = this.directoryGrants(organizationId);
    const attached = rows
      .toSorted((left, right) => msOf(right.createdAt) - msOf(left.createdAt))
      .slice(0, limit);
    const removed = rows
      .filter((row) => row.revokedAt !== null)
      .toSorted((left, right) => msOf(right.revokedAt!) - msOf(left.revokedAt!))
      .slice(0, limit);
    return { attached: attached.map(directoryRow), removed: removed.map(directoryRow) };
  }

  async findOwnedApiKeys({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<{ id: string; name: string }[]> {
    return this.memory.apiKeys
      .filter(
        (row) =>
          row.userId === userId && row.organizationId === organizationId && row.revokedAt === null,
      )
      .map((row) => ({ id: row.id, name: row.name }));
  }

  async findPersonalTeams({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<{ id: string; name: string }[]> {
    return this.memory.teams
      .filter(
        (row) =>
          row.organizationId === organizationId && row.isPersonal && row.ownerUserId === userId,
      )
      .map((row) => ({ id: row.id, name: row.name }));
  }

  /** Rolls the seat, the legacy rows and the invites back when `revoke` or `prove` throws. */
  async offboardUser({
    userId,
    organizationId,
    revoke,
    prove,
  }: {
    userId: string;
    organizationId: string;
    revoke: (grantIds: string[]) => Promise<void>;
    prove: (reader: AuthzReadRepository) => Promise<void>;
  }): Promise<{
    groupMemberships: number;
    legacyTeamMemberships: number;
    pendingInvites: number;
    organizationMembership: boolean;
  }> {
    const { memory } = this;
    const restore = this.snapshot();
    try {
      const organizationMembership = memory.memberships.delete(
        memory.membershipKey(organizationId, userId),
      );
      const isUserGrant = (row: AuthzMemoryGrantRow) =>
        row.organizationId === organizationId &&
        row.principalType === "USER" &&
        row.principalId === userId;
      await revoke(
        this.liveGrants()
          .filter(isUserGrant)
          .map((row) => row.id),
      );

      remove(
        memory.bindings,
        (row) => row.organizationId === organizationId && row.userId === userId,
      );
      const groupMemberships = remove(
        memory.groupMemberships,
        (row) => row.userId === userId && memory.isGroupIn(row.groupId, organizationId),
      );
      const legacyTeamMemberships = remove(
        memory.teamMemberships,
        (row) => row.userId === userId && memory.isTeamIn(row.teamId, organizationId),
      );
      const email = memory.users.find((row) => row.id === userId)?.email ?? null;
      const pendingInvites = email
        ? remove(
            memory.organizationInvites,
            (row) =>
              row.organizationId === organizationId &&
              row.email === email &&
              row.status === "PENDING",
          )
        : 0;

      const remainingGrantHeads = this.liveGrants().filter(isUserGrant).length;
      if (remainingGrantHeads > 0) {
        throw new OffboardIncompleteError({ userId, organizationId, remainingGrantHeads });
      }
      await prove(MemoryAuthzReadRepository.create({ memory }));

      return {
        groupMemberships,
        legacyTeamMemberships,
        pendingInvites,
        organizationMembership,
      };
    } catch (error) {
      restore();
      throw error;
    }
  }

  /** The rows the offboarding transaction deletes, as they were before it began. */
  private snapshot(): () => void {
    const { memory } = this;
    const memberships = [...memory.memberships];
    const tables = [
      memory.bindings,
      memory.groupMemberships,
      memory.teamMemberships,
      memory.organizationInvites,
    ] as unknown[][];
    const copies = tables.map((rows) => [...rows]);
    return () => {
      memory.memberships.clear();
      for (const [key, row] of memberships) memory.memberships.set(key, row);
      tables.forEach((rows, index) => rows.splice(0, rows.length, ...copies[index]!));
    };
  }
}

/** Delete the matching rows in place; answers how many went. */
function remove<Row>(rows: Row[], matches: (row: Row) => boolean): number {
  const kept = rows.filter((row) => !matches(row));
  const removed = rows.length - kept.length;
  rows.splice(0, rows.length, ...kept);
  return removed;
}
