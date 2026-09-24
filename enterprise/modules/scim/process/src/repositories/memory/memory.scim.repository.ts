// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  DirectoryIdentityRow,
  ScimDirectoryOwnership,
  ScimRequestLogEntry,
  ScimRequestRecord,
} from "@langwatch/enterprise-scim-contract";
import { nowInstant, toDate, type Instant } from "@langwatch/time";

import {
  ScimRepository,
  type ScimDirectoryIdentityRecord,
  type ScimGrantBindingScope,
  type ScimGroupMembershipRecord,
  type ScimGroupRecord,
  type ScimMembershipRecord,
  type ScimOrganizationUserRecord,
  type ScimRoleBindingRecord,
  type ScimTokenIdentity,
  type ScimTokenRecord,
  type ScimUserRecord,
  type ScimUserResourceRecord,
} from "../scim.repository.ts";

type StoredToken = ScimTokenRecord & { hashedToken: string };
type StoredRequest = ScimRequestLogEntry;
type StoredMembership = { organizationId: string; userId: string; role: string };
type StoredGroupMember = { groupId: string; userId: string };
type StoredOrganization = { id: string; ssoDomain: string | null };
type StoredBinding = ScimRoleBindingRecord & { organizationId: string };

const sameName = (left: string, right: string): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

/**
 * The SCIM rows in memory: what the process runs on when it selected the
 * memory tier. Accounts, organizations, connections and role bindings belong
 * to other owners, so a caller seeds them; everything SCIM writes lives here.
 */
export class MemoryScimRepository extends ScimRepository {
  readonly users = new Map<string, ScimUserRecord>();
  readonly organizations = new Map<string, StoredOrganization>();
  readonly connections: { organizationId: string; connectionId: string }[] = [];
  readonly bindings: StoredBinding[] = [];
  readonly memberships: StoredMembership[] = [];
  readonly resources: ScimUserResourceRecord[] = [];
  readonly groups: ScimGroupRecord[] = [];
  readonly groupMembers: StoredGroupMember[] = [];
  readonly tokens: StoredToken[] = [];
  readonly requests: StoredRequest[] = [];
  readonly directoryIdentities: ScimDirectoryIdentityRecord[] = [];
  readonly #identityTimes = new Map<string, { createdAtMs: number; updatedAtMs: number }>();
  #sequence = 0;

  private constructor(private readonly now: () => Instant) {
    super();
  }

  static create({ now = nowInstant }: { now?: () => Instant } = {}): MemoryScimRepository {
    return new MemoryScimRepository(now);
  }

  #nextId(prefix: string): string {
    this.#sequence += 1;
    return `${prefix}_${this.#sequence}`;
  }

  #userOf(userId: string): ScimUserRecord {
    const user = this.users.get(userId);
    if (!user) throw new Error(`No account "${userId}" was seeded into the memory SCIM store`);
    return user;
  }

  #memberUserOf(userId: string): ScimGroupMembershipRecord["user"] {
    const user = this.#userOf(userId);
    return { id: user.id, email: user.email, name: user.name };
  }

  #isMember(input: { organizationId: string; userId: string }): boolean {
    return this.memberships.some(
      (row) => row.organizationId === input.organizationId && row.userId === input.userId,
    );
  }

  #hasResource(input: { organizationId: string; userId: string }): boolean {
    return this.resources.some(
      (row) => row.organizationId === input.organizationId && row.userId === input.userId,
    );
  }

  async findOrganizationBySsoDomain(input: { domain: string }): Promise<{ id: string } | null> {
    for (const organization of this.organizations.values()) {
      if (organization.ssoDomain === input.domain) return { id: organization.id };
    }
    return null;
  }

  findMembership = async (input: {
    organizationId: string;
    userId: string;
  }): Promise<ScimMembershipRecord | null> => {
    const row = this.memberships.find(
      (membership) =>
        membership.organizationId === input.organizationId && membership.userId === input.userId,
    );
    return row ? { ...row, user: this.#userOf(row.userId) } : null;
  };

  findOrganizationUsers = async (input: {
    organizationId: string;
    userName?: string;
    userIds?: readonly string[];
    startIndex: number;
    count: number;
  }): Promise<{ rows: ScimOrganizationUserRecord[]; total: number }> => {
    const narrowed = (userId: string) => !input.userIds || input.userIds.includes(userId);
    const named = input.userName;
    const claimed = this.resources
      .filter(
        (row) =>
          row.organizationId === input.organizationId &&
          row.deletedAt === null &&
          narrowed(row.userId) &&
          (!named || sameName(row.userName, named)),
      )
      .toSorted((left, right) => left.userId.localeCompare(right.userId))
      .map((resource) => ({ user: this.#userOf(resource.userId), resource }));
    const unclaimed = this.memberships
      .filter(
        (row) =>
          row.organizationId === input.organizationId &&
          narrowed(row.userId) &&
          !this.#hasResource(row) &&
          (!named || sameName(this.#userOf(row.userId).email ?? "", named)),
      )
      .toSorted((left, right) => left.userId.localeCompare(right.userId))
      .map((row) => ({ user: this.#userOf(row.userId), resource: null }));
    const all: ScimOrganizationUserRecord[] = [...claimed, ...unclaimed];
    const skip = input.startIndex - 1;

    return { rows: all.slice(skip, skip + input.count), total: all.length };
  };

  recordRequest = async (request: ScimRequestRecord): Promise<void> => {
    this.requests.push({ ...request, id: this.#nextId("scimreq"), occurredAt: toDate(this.now()) });
  };

  async findRequestLog(input: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<ScimRequestLogEntry[]> {
    return this.requests
      .filter(
        (row) =>
          row.organizationId === input.organizationId && row.connectionId === input.connectionId,
      )
      .toSorted((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
      .slice(0, input.limit);
  }

  async findExpiredRequestIds(input: { before: Instant; limit: number }): Promise<string[]> {
    const before = input.before.epochMilliseconds;
    return this.requests
      .filter((row) => row.occurredAt.getTime() < before)
      .slice(0, input.limit)
      .map((row) => row.id);
  }

  async deleteRequests(input: { ids: readonly string[] }): Promise<number> {
    const doomed = new Set(input.ids);
    const before = this.requests.length;
    this.requests.splice(
      0,
      this.requests.length,
      ...this.requests.filter((row) => !doomed.has(row.id)),
    );
    return before - this.requests.length;
  }

  findUserResource = async (input: {
    organizationId: string;
    userId: string;
  }): Promise<ScimUserResourceRecord | null> =>
    this.resources.find(
      (row) => row.organizationId === input.organizationId && row.userId === input.userId,
    ) ?? null;

  findUserByResourceName = async (input: {
    organizationId: string;
    userName: string;
  }): Promise<ScimUserRecord | null> => {
    const row = this.resources.find(
      (resource) =>
        resource.organizationId === input.organizationId &&
        resource.deletedAt === null &&
        sameName(resource.userName, input.userName),
    );
    return row ? this.#userOf(row.userId) : null;
  };

  hasLegacyNameConflict = async (input: {
    organizationId: string;
    userId?: string;
    userName: string;
  }): Promise<boolean> =>
    this.memberships.some(
      (row) =>
        row.organizationId === input.organizationId &&
        row.userId !== input.userId &&
        !this.#hasResource(row) &&
        sameName(this.#userOf(row.userId).email ?? "", input.userName),
    );

  saveUserResource = async (input: {
    organizationId: string;
    userId: string;
    userName: string;
    name: string | null;
    active: boolean;
  }): Promise<ScimUserResourceRecord> =>
    this.#upsertResource({
      ...input,
      userName: input.userName.trim().toLowerCase(),
      deletedAt: null,
    });

  markUserResourceDeleted = async (input: {
    organizationId: string;
    userId: string;
    userName: string;
    name: string | null;
  }): Promise<void> => {
    const existing = await this.findUserResource(input);
    this.#upsertResource({
      organizationId: input.organizationId,
      userId: input.userId,
      userName: existing?.userName ?? input.userName.trim().toLowerCase(),
      name: existing?.name ?? input.name,
      active: false,
      deletedAt: this.now(),
    });
  };

  #upsertResource(
    input: Omit<ScimUserResourceRecord, "createdAt" | "updatedAt">,
  ): ScimUserResourceRecord {
    const at = this.now();
    const index = this.resources.findIndex(
      (row) => row.organizationId === input.organizationId && row.userId === input.userId,
    );
    const createdAt = index === -1 ? at : this.resources[index]!.createdAt;
    const saved: ScimUserResourceRecord = { ...input, createdAt, updatedAt: at };
    if (index === -1) this.resources.push(saved);
    else this.resources[index] = saved;
    return saved;
  }

  addMembership = async (input: {
    organizationId: string;
    userId: string;
    role: string;
  }): Promise<void> => {
    if (this.#isMember(input)) throw new Error("The membership already exists");
    this.memberships.push({ ...input });
  };

  removeMembership = async (input: { organizationId: string; userId: string }): Promise<void> => {
    const index = this.memberships.findIndex(
      (row) => row.organizationId === input.organizationId && row.userId === input.userId,
    );
    if (index === -1) throw new Error("No such membership to remove");
    this.memberships.splice(index, 1);
  };

  async findGroup(input: { organizationId: string; id: string }): Promise<ScimGroupRecord | null> {
    return (
      this.groups.find(
        (row) => row.id === input.id && row.organizationId === input.organizationId,
      ) ?? null
    );
  }

  async listGroups(input: {
    organizationId: string;
    connectionId?: string | null;
    displayName?: string;
    externalId?: string;
    startIndex: number;
    count: number;
  }): Promise<{
    rows: (ScimGroupRecord & { members: ScimGroupMembershipRecord[] })[];
    total: number;
  }> {
    const matching = this.groups
      .filter(
        (row) =>
          row.organizationId === input.organizationId &&
          row.scimSource !== null &&
          (!input.connectionId ||
            row.connectionId === input.connectionId ||
            row.connectionId === null) &&
          (!input.displayName || sameName(row.name, input.displayName)) &&
          (input.externalId === undefined || row.externalId === input.externalId),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.epochMilliseconds - right.createdAt.epochMilliseconds ||
          left.id.localeCompare(right.id),
      );
    const skip = input.startIndex - 1;
    const page = matching.slice(skip, skip + input.count);

    return {
      rows: await Promise.all(
        page.map(async (group) => ({
          ...group,
          members: await this.listGroupMembers({ groupId: group.id }),
        })),
      ),
      total: matching.length,
    };
  }

  async findGroupByExternalId(input: {
    organizationId: string;
    connectionId: string | null;
    externalId: string;
  }): Promise<ScimGroupRecord | null> {
    return (
      this.groups.find(
        (row) =>
          row.organizationId === input.organizationId &&
          row.connectionId === input.connectionId &&
          row.externalId === input.externalId,
      ) ?? null
    );
  }

  async createGroup(input: {
    organizationId: string;
    name: string;
    slug: string;
    externalId: string | null;
    connectionId: string | null;
  }): Promise<ScimGroupRecord> {
    const at = this.now();
    const group: ScimGroupRecord = {
      ...input,
      id: this.#nextId("group"),
      scimSource: "scim",
      createdAt: at,
      updatedAt: at,
    };
    this.groups.push(group);
    return group;
  }

  async renameGroup(input: { id: string; name: string }): Promise<void> {
    const index = this.groups.findIndex((row) => row.id === input.id);
    if (index === -1) throw new Error(`No group "${input.id}" to rename`);
    this.groups[index] = { ...this.groups[index]!, name: input.name, updatedAt: this.now() };
  }

  async deleteGroup(input: { id: string }): Promise<void> {
    const index = this.groups.findIndex((row) => row.id === input.id);
    if (index === -1) throw new Error(`No group "${input.id}" to delete`);
    this.groups.splice(index, 1);
    await this.removeGroupMembers({
      groupId: input.id,
      userIds: await this.listGroupMemberIds({ groupId: input.id }),
    });
  }

  async listGroupMembers(input: { groupId: string }): Promise<ScimGroupMembershipRecord[]> {
    return this.groupMembers
      .filter((row) => row.groupId === input.groupId)
      .map((row) => ({ ...row, user: this.#memberUserOf(row.userId) }));
  }

  async listGroupMemberIds(input: { groupId: string }): Promise<string[]> {
    return this.groupMembers
      .filter((row) => row.groupId === input.groupId)
      .map((row) => row.userId);
  }

  async addGroupMember(input: {
    groupId: string;
    organizationId: string;
    userId: string;
  }): Promise<void> {
    if (!this.#isMember(input)) return;
    const present = this.groupMembers.some(
      (row) => row.groupId === input.groupId && row.userId === input.userId,
    );
    if (!present) this.groupMembers.push({ groupId: input.groupId, userId: input.userId });
  }

  async removeGroupMembers(input: { groupId: string; userIds: string[] }): Promise<void> {
    const leaving = new Set(input.userIds);
    const kept = this.groupMembers.filter(
      (row) => row.groupId !== input.groupId || !leaving.has(row.userId),
    );
    this.groupMembers.splice(0, this.groupMembers.length, ...kept);
  }

  async groupSlugExists(input: { organizationId: string; slug: string }): Promise<boolean> {
    return this.groups.some(
      (row) => row.organizationId === input.organizationId && row.slug === input.slug,
    );
  }

  async listRoleBindings(scope: ScimGrantBindingScope): Promise<ScimRoleBindingRecord[]> {
    return this.bindings
      .filter((binding) => {
        if (binding.organizationId !== scope.organizationId) return false;
        if (scope.kind === "group") return binding.groupId === scope.groupId;
        if (scope.kind === "member-offboarding") return binding.userId === scope.userId;
        return (
          binding.userId === scope.userId &&
          binding.scopeType === "ORGANIZATION" &&
          binding.scopeId === scope.organizationId
        );
      })
      .map(({ organizationId: _organizationId, ...binding }) => binding);
  }

  createToken = async (input: {
    organizationId: string;
    connectionId: string;
    hashedToken: string;
    description: string | null;
  }): Promise<{ id: string }> => {
    const id = this.#nextId("scimtok");
    this.tokens.push({ ...input, id, createdAt: toDate(this.now()), lastUsedAt: null });
    return { id };
  };

  async listTokens(organizationId: string): Promise<ScimTokenRecord[]> {
    return this.tokens
      .filter((row) => row.organizationId === organizationId)
      .toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map(({ hashedToken: _hashedToken, ...token }) => token);
  }

  revokeToken = async (input: { organizationId: string; tokenId: string }): Promise<boolean> =>
    this.#dropTokens(
      (row) => row.id === input.tokenId && row.organizationId === input.organizationId,
    ) > 0;

  async findToken(input: {
    organizationId: string;
    tokenId: string;
  }): Promise<ScimTokenIdentity | null> {
    const row = this.tokens.find(
      (token) => token.id === input.tokenId && token.organizationId === input.organizationId,
    );
    return row ? identityOf(row) : null;
  }

  async revokeTokensForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<number> {
    return this.#dropTokens(
      (row) =>
        row.organizationId === input.organizationId && row.connectionId === input.connectionId,
    );
  }

  #dropTokens(matches: (row: StoredToken) => boolean): number {
    const kept = this.tokens.filter((row) => !matches(row));
    const dropped = this.tokens.length - kept.length;
    this.tokens.splice(0, this.tokens.length, ...kept);
    return dropped;
  }

  async findTokenIdsForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<string[]> {
    return this.tokens
      .filter(
        (row) =>
          row.organizationId === input.organizationId && row.connectionId === input.connectionId,
      )
      .map(({ id }) => id);
  }

  async moveDirectoryToConnection({
    organizationId,
    fromConnectionId,
    toConnectionId,
    tokenIds,
  }: {
    organizationId: string;
    fromConnectionId: string;
    toConnectionId: string;
    tokenIds: readonly string[];
  }): Promise<void> {
    for (const token of this.tokens) {
      if (
        token.organizationId === organizationId &&
        token.connectionId === fromConnectionId &&
        tokenIds.includes(token.id)
      ) {
        token.connectionId = toConnectionId;
      }
    }
    const own = new Set(
      this.directoryIdentities
        .filter((row) => row.connectionId === toConnectionId)
        .map((row) => row.externalId),
    );
    const moved = this.directoryIdentities.flatMap((row) => {
      if (row.connectionId !== fromConnectionId) return [row];
      if (own.has(row.externalId)) return [];
      return [{ ...row, connectionId: toConnectionId }];
    });
    this.directoryIdentities.splice(0, this.directoryIdentities.length, ...moved);
  }

  async findTokenByHash(hashedToken: string): Promise<ScimTokenIdentity | null> {
    const row = this.tokens.find((token) => token.hashedToken === hashedToken);
    return row ? identityOf(row) : null;
  }

  recordTokenUse = async (input: { tokenId: string; usedAt: Instant }): Promise<void> => {
    for (const token of this.tokens) {
      if (token.id === input.tokenId) token.lastUsedAt = toDate(input.usedAt);
    }
  };

  async scimConnectionExists(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<boolean> {
    return this.connections.some(
      (row) =>
        row.organizationId === input.organizationId && row.connectionId === input.connectionId,
    );
  }

  async findDirectoryUserId(input: {
    connectionId: string;
    externalId: string;
  }): Promise<string | null> {
    return (
      this.directoryIdentities.find(
        (row) => row.connectionId === input.connectionId && row.externalId === input.externalId,
      )?.userId ?? null
    );
  }

  async rememberDirectoryIdentity(input: ScimDirectoryIdentityRecord): Promise<void> {
    const key = `${input.connectionId}\u0000${input.externalId}`;
    const at = this.now().epochMilliseconds;
    const createdAtMs = this.#identityTimes.get(key)?.createdAtMs ?? at;
    await this.forgetDirectoryIdentity(input);
    this.directoryIdentities.push({ ...input });
    this.#identityTimes.set(key, { createdAtMs, updatedAtMs: at });
  }

  async findDirectoryIdentities(input: {
    connectionId: string;
    limit: number;
  }): Promise<DirectoryIdentityRow[]> {
    return this.directoryIdentities
      .filter((row) => row.connectionId === input.connectionId)
      .map((row) => {
        const times = this.#identityTimes.get(`${row.connectionId}\u0000${row.externalId}`);
        return {
          ...row,
          createdAtMs: times?.createdAtMs ?? 0,
          updatedAtMs: times?.updatedAtMs ?? 0,
        };
      })
      .toSorted((left, right) => right.updatedAtMs - left.updatedAtMs)
      .slice(0, input.limit);
  }

  async forgetDirectoryIdentity(input: {
    connectionId: string;
    externalId: string;
  }): Promise<void> {
    this.#dropIdentities(
      (row) => row.connectionId === input.connectionId && row.externalId === input.externalId,
    );
  }

  async forgetDirectoryIdentitiesForUser(input: {
    connectionId: string;
    userId: string;
  }): Promise<void> {
    this.#dropIdentities(
      (row) => row.connectionId === input.connectionId && row.userId === input.userId,
    );
  }

  #dropIdentities(matches: (row: ScimDirectoryIdentityRecord) => boolean): void {
    const kept = this.directoryIdentities.filter((row) => !matches(row));
    this.directoryIdentities.splice(0, this.directoryIdentities.length, ...kept);
  }

  async listDirectoryConnectionsForUser(input: { userId: string }): Promise<string[]> {
    return this.directoryIdentities
      .filter((row) => row.userId === input.userId)
      .map((row) => row.connectionId);
  }

  async findDirectoryOwnership(input: {
    connectionIds: string[];
  }): Promise<ScimDirectoryOwnership[]> {
    return this.directoryIdentities
      .filter((row) => input.connectionIds.includes(row.connectionId))
      .map((row) => ({ connectionId: row.connectionId, userId: row.userId }));
  }
}

function identityOf(token: StoredToken): ScimTokenIdentity {
  return { id: token.id, organizationId: token.organizationId, connectionId: token.connectionId };
}
