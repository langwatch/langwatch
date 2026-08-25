// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { SYSTEM_ACTORS } from "@langwatch/actor";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { Group, PrismaClient } from "~/generated/prisma/client";
import {
  type GrantsLedgerWriter,
  grantsLedgerWriter,
  newGroupMembershipId,
} from "~/server/app-layer/authz/ledger";
import {
  LIVE_MEMBERSHIP,
  liveGroupMemberships,
} from "~/server/app-layer/authz/repositories/live-rows";
import { KSUID_RESOURCES } from "~/utils/constants";
import { slugify } from "~/utils/slugify";
import type {
  ScimCreateGroupRequest,
  ScimError,
  ScimGroup,
  ScimListResponse,
  ScimPatchOperation,
  ScimPatchRequest,
  ScimReplaceGroupRequest,
} from "./scim.types";
import { reconcileScimGrants } from "./scim-grants.reconciler";

const logger = createLogger("langwatch:scim:group");

/**
 * What a PATCH operation said about a group's membership. `absent` and
 * `malformed` both mean "change nothing", but only one of them is a payload
 * anybody needs to hear about.
 */
type MemberInstruction =
  | { kind: "list"; ids: string[] }
  | { kind: "malformed" }
  | { kind: "absent" };

/**
 * Handles SCIM 2.0 Group resources backed by the Group / GroupMembership tables.
 * Groups pushed from an IdP arrive here unmapped — admins assign role bindings
 * via the Groups settings page.
 */
export class ScimGroupService {
  private readonly prisma: PrismaClient;
  private readonly writer: GrantsLedgerWriter;

  constructor({
    prisma,
    writer = grantsLedgerWriter(),
  }: {
    prisma: PrismaClient;
    writer?: GrantsLedgerWriter;
  }) {
    this.prisma = prisma;
    this.writer = writer;
  }

  static create(options: {
    prisma: PrismaClient;
    writer?: GrantsLedgerWriter;
  }): ScimGroupService {
    return new ScimGroupService(options);
  }

  async listGroups({
    organizationId,
    filter,
    startIndex = 1,
    count = 100,
    excludeMembers = false,
  }: {
    organizationId: string;
    filter?: string;
    startIndex?: number;
    count?: number;
    excludeMembers?: boolean;
  }): Promise<ScimListResponse<ScimGroup>> {
    const displayNameFilter = this.parseDisplayNameFilter(filter);

    const where = {
      organizationId,
      scimSource: { not: null as string | null },
      ...(displayNameFilter
        ? { name: { equals: displayNameFilter, mode: "insensitive" as const } }
        : {}),
    };

    const [groups, totalCount] = await Promise.all([
      this.prisma.group.findMany({
        where,
        include: {
          // LIVE members. A SCIM list says who is in each group NOW, and a
          // membership the directory ended is not that.
          members: {
            where: LIVE_MEMBERSHIP,
            include: {
              user: { select: { id: true, email: true, name: true } },
            },
          },
        },
        skip: startIndex - 1,
        take: count,
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.group.count({ where }),
    ]);

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: totalCount,
      startIndex,
      itemsPerPage: count,
      Resources: groups.map((g) =>
        this.toScimGroup(g, g.members, excludeMembers),
      ),
    };
  }

  async getGroup({
    scimResourceId,
    organizationId,
    excludeMembers = false,
  }: {
    scimResourceId: string;
    organizationId: string;
    excludeMembers?: boolean;
  }): Promise<ScimGroup | ScimError> {
    const group = await this.findGroup({ scimResourceId, organizationId });
    if (!group)
      return this.scimError({ status: "404", detail: "Group not found" });

    const members = await liveGroupMemberships(this.prisma).findMany({
      where: { groupId: group.id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    return this.toScimGroup(group, members, excludeMembers);
  }

  async createGroup({
    request,
    organizationId,
    connectionId = null,
  }: {
    request: ScimCreateGroupRequest;
    organizationId: string;
    connectionId?: string | null;
  }): Promise<ScimGroup | ScimError> {
    // The directory's own identifier first, and the display name second: a
    // group renamed in the directory is the same group, and matching on the
    // name would make it a second one.
    const existing = await this.findExistingGroup({
      organizationId,
      connectionId,
      externalId: request.externalId ?? null,
      displayName: request.displayName,
    });
    if (existing) {
      return this.scimError({
        status: "409",
        detail: "A group with this name already exists",
      });
    }

    const slug = await this.uniqueSlug(organizationId, request.displayName);
    const group = await this.prisma.group.create({
      data: {
        id: generate(KSUID_RESOURCES.GROUP).toString(),
        organizationId,
        name: request.displayName,
        slug,
        scimSource: "scim",
        externalId: request.externalId ?? null,
        scimConnectionId: connectionId,
      },
    });

    if (request.members?.length) {
      await this.addMembers({
        groupId: group.id,
        organizationId,
        memberIds: request.members.map((m) => m.value),
      });
    }

    const members = await liveGroupMemberships(this.prisma).findMany({
      where: { groupId: group.id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    return this.toScimGroup(group, members);
  }

  async replaceGroup({
    scimResourceId,
    organizationId,
    request,
  }: {
    scimResourceId: string;
    organizationId: string;
    request: ScimReplaceGroupRequest;
  }): Promise<ScimGroup | ScimError> {
    const group = await this.findGroup({ scimResourceId, organizationId });
    if (!group)
      return this.scimError({ status: "404", detail: "Group not found" });

    // A PUT restates the whole resource, so it restates the directory's own
    // identifier too. It used to be accepted on create only, which meant a
    // directory that started sending one later could never attach it.
    const renamed = request.displayName !== group.name;
    const reidentified =
      request.externalId != null && request.externalId !== group.externalId;
    if (renamed || reidentified) {
      await this.prisma.group.update({
        where: { id: group.id },
        data: {
          ...(renamed ? { name: request.displayName } : {}),
          ...(reidentified ? { externalId: request.externalId } : {}),
        },
      });
    }

    const requestedIds = new Set((request.members ?? []).map((m) => m.value));
    const current = await liveGroupMemberships(this.prisma).findMany({
      where: { groupId: group.id },
    });
    const currentIds = new Set(current.map((m) => m.userId));

    const toAdd = [...requestedIds].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !requestedIds.has(id));

    if (toAdd.length)
      await this.addMembers({
        groupId: group.id,
        organizationId,
        memberIds: toAdd,
      });
    if (toRemove.length)
      await this.removeMembers({
        groupId: group.id,
        organizationId,
        userIds: toRemove,
      });

    const updatedGroup = await this.prisma.group.findUniqueOrThrow({
      where: { id: group.id },
    });
    const members = await liveGroupMemberships(this.prisma).findMany({
      where: { groupId: group.id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    return this.toScimGroup(updatedGroup, members);
  }

  async updateGroup({
    scimResourceId,
    organizationId,
    patchRequest,
  }: {
    scimResourceId: string;
    organizationId: string;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimGroup | ScimError> {
    const group = await this.findGroup({ scimResourceId, organizationId });
    if (!group)
      return this.scimError({ status: "404", detail: "Group not found" });

    for (const operation of patchRequest.Operations) {
      await this.applyPatch({ group, operation, organizationId });
    }

    const updatedGroup = await this.prisma.group.findUniqueOrThrow({
      where: { id: group.id },
    });
    const members = await liveGroupMemberships(this.prisma).findMany({
      where: { groupId: group.id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    return this.toScimGroup(updatedGroup, members);
  }

  async deleteGroup({
    scimResourceId,
    organizationId,
  }: {
    scimResourceId: string;
    organizationId: string;
  }): Promise<ScimError | null> {
    const group = await this.findGroup({ scimResourceId, organizationId });
    if (!group)
      return this.scimError({ status: "404", detail: "Group not found" });

    // The grants the group carried go first and carry instant enforcement:
    // an IdP that deletes a group has taken that access away. Reconciled to
    // the empty set, so a repeated delete emits nothing.
    await reconcileScimGrants({
      prisma: this.prisma,
      writer: this.writer,
      organizationId,
      where: { groupId: group.id },
      desired: [],
      actor: { type: "system", id: SYSTEM_ACTORS.scim },
      mintBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
    });
    // The memberships END before the group row goes, so the ledger and the
    // audit trail carry who was in it and when the directory took them out.
    // The group row's own deletion still cascades the marked rows away — the
    // limit is stated on the `GroupMembership` model.
    await this.writer.removeGroupMembersWhere({
      organizationId,
      where: { groupId: group.id },
      actor: { type: "system", id: SYSTEM_ACTORS.scim },
      reason: "group deleted by the identity provider",
    });
    await this.prisma.group.delete({ where: { id: group.id } });

    return null;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * The group this push is about, before one exists.
   *
   * `(connectionId, externalId)` is the key when the directory sends its own
   * identifier, so two connections in one organization can each carry their
   * own "engineering" and a group renamed in the directory stays one group.
   * The display name is the fallback for a push that carries no identifier —
   * which is what the previous code did unconditionally, and is why a renamed
   * group arrived as a second one.
   */
  private async findExistingGroup({
    organizationId,
    connectionId,
    externalId,
    displayName,
  }: {
    organizationId: string;
    connectionId: string | null;
    externalId: string | null;
    displayName: string;
  }): Promise<Group | null> {
    if (connectionId && externalId) {
      const byIdentifier = await this.prisma.group.findFirst({
        where: { organizationId, scimConnectionId: connectionId, externalId },
      });
      if (byIdentifier) return byIdentifier;
    }
    return this.prisma.group.findFirst({
      where: {
        organizationId,
        name: displayName,
        scimSource: { not: null },
      },
    });
  }

  /**
   * The group a `/Groups/:id` request names.
   *
   * `:id` is the SERVICE PROVIDER's identifier (RFC 7643 §3.1) — ours, minted
   * by us and stored by the directory — so resolving it against `Group.id` is
   * correct. What was wrong was the name: the parameter was called
   * `externalScimId`, which says it is the DIRECTORY's identifier, and
   * `externalId` is a different column that this never read. Renamed rather
   * than re-pointed, because re-pointing it would break every identity
   * provider that has already stored the ids we handed out.
   */
  private async findGroup({
    scimResourceId,
    organizationId,
  }: {
    scimResourceId: string;
    organizationId: string;
  }): Promise<Group | null> {
    return this.prisma.group.findFirst({
      where: { id: scimResourceId, organizationId },
    });
  }

  /**
   * The directory's members, as facts. `source: "scim"` is what marks the
   * change as the IdP's rather than an admin's, and it stays auditable — a
   * directory sync IS a change somebody made, unlike the backdated sources the
   * audit subscriber skips.
   *
   * The per-member upsert this replaces is now the writer's own liveness
   * pre-check plus one command per pair, so a repeated sync of an unchanged
   * group emits nothing at all rather than N no-op upserts.
   */
  private async addMembers({
    groupId,
    organizationId,
    memberIds,
  }: {
    groupId: string;
    organizationId: string;
    memberIds: string[];
  }): Promise<void> {
    const orgMembers = await this.prisma.organizationUser.findMany({
      where: { organizationId, userId: { in: memberIds } },
      select: { userId: true },
    });
    const validIds = new Set(orgMembers.map((m) => m.userId));
    const memberships = memberIds
      .filter((userId) => validIds.has(userId))
      .map((userId) => ({
        membershipId: newGroupMembershipId(),
        groupId,
        userId,
      }));
    if (memberships.length === 0) return;

    await this.writer.addGroupMembers({
      organizationId,
      memberships,
      actor: { type: "system", id: SYSTEM_ACTORS.scim },
      source: "scim",
      onDuplicate: "skip",
    });
  }

  /**
   * The directory dropped these people from the group, so the membership ENDS
   * — it is not erased. A `deleteMany` here threw away when the IdP removed
   * them, which is the one thing an access review asks about a leaver.
   */
  private async removeMembers({
    groupId,
    organizationId,
    userIds,
  }: {
    groupId: string;
    organizationId: string;
    userIds: string[];
  }): Promise<void> {
    for (const userId of userIds) {
      await this.writer.removeGroupMembersWhere({
        organizationId,
        where: { groupId, userId },
        actor: { type: "system", id: SYSTEM_ACTORS.scim },
        reason: "removed from group by the identity provider",
      });
    }
  }

  private async applyPatch({
    group,
    operation,
    organizationId,
  }: {
    group: Group;
    operation: ScimPatchOperation;
    organizationId: string;
  }): Promise<void> {
    if (operation.op === "add" && operation.path === "members") {
      const ids = this.extractMemberIds(operation.value);
      if (ids.length)
        await this.addMembers({
          groupId: group.id,
          organizationId,
          memberIds: ids,
        });
      return;
    }

    if (operation.op === "remove" && operation.path?.startsWith("members")) {
      const ids = this.extractMemberIdsFromPath(
        operation.path,
        operation.value,
      );
      if (ids.length)
        await this.removeMembers({
          groupId: group.id,
          organizationId,
          userIds: ids,
        });
      return;
    }

    if (operation.op === "replace") {
      if (
        operation.path === "displayName" &&
        typeof operation.value === "string"
      ) {
        await this.prisma.group.update({
          where: { id: group.id },
          data: { name: operation.value },
        });
        return;
      }

      // Handle value object containing "displayName" (no path variant)
      let renamed = false;
      if (
        !operation.path &&
        typeof operation.value === "object" &&
        operation.value !== null
      ) {
        const valueObj = operation.value as Record<string, unknown>;
        if (
          "displayName" in valueObj &&
          typeof valueObj.displayName === "string"
        ) {
          await this.prisma.group.update({
            where: { id: group.id },
            data: { name: valueObj.displayName },
          });
          renamed = true;
        }
      }

      // Full member replace (path="members" or no path with members in value).
      // Only when the operation actually carries a member list: an operation
      // that never mentions members carries no membership instruction at all.
      const instruction = this.extractRequestedMemberIds(operation);
      if (instruction.kind !== "list") {
        // Doing nothing is the safe answer, but it is also a silent one: an IdP
        // sending a shape we do not parse would otherwise look like a success
        // forever. Logged so a misconfigured sync is findable without an
        // access-loss incident pointing at it.
        if (instruction.kind === "malformed") {
          logger.warn(
            { groupId: group.id, path: operation.path },
            "SCIM group replace named members but did not give a list; membership left unchanged",
          );
        } else if (!renamed) {
          // Nothing recognised at all. A rename that mentions no members is a
          // complete, supported operation, so it must not warn.
          logger.warn(
            { groupId: group.id, path: operation.path },
            "SCIM group replace matched no known attribute; leaving the group unchanged",
          );
        }
        return;
      }
      const members = instruction.ids;

      const current = await liveGroupMemberships(this.prisma).findMany({
        where: { groupId: group.id },
      });
      const requestedIds = new Set(members);
      const currentIds = new Set(current.map((m) => m.userId));

      const toAdd = members.filter((id) => !currentIds.has(id));
      const toRemove = [...currentIds].filter((id) => !requestedIds.has(id));

      if (toAdd.length)
        await this.addMembers({
          groupId: group.id,
          organizationId,
          memberIds: toAdd,
        });
      if (toRemove.length)
        await this.removeMembers({
          groupId: group.id,
          organizationId,
          userIds: toRemove,
        });
    }
  }

  private async uniqueSlug(
    organizationId: string,
    name: string,
  ): Promise<string> {
    const base = slugify(name, { lower: true, strict: true }) || "group";
    let slug = base;
    let i = 1;
    while (
      await this.prisma.group.findFirst({ where: { organizationId, slug } })
    ) {
      slug = `${base}-${i++}`;
    }
    return slug;
  }

  private toScimGroup(
    group: Group,
    members: Array<{
      userId: string;
      user: { id: string; email: string | null; name: string | null };
    }>,
    excludeMembers = false,
  ): ScimGroup {
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: group.id,
      // Echoed when we hold one. A directory that sent an externalId and
      // never got it back could not tell that we kept it, which is what made
      // the create-only cast below invisible for as long as it was wrong.
      ...(group.externalId ? { externalId: group.externalId } : {}),
      displayName: group.name,
      ...(excludeMembers
        ? {}
        : {
            members: members.map((m) => ({
              value: m.userId,
              display: m.user.email ?? m.user.name ?? undefined,
            })),
          }),
      meta: {
        resourceType: "Group",
        created: group.createdAt.toISOString(),
        lastModified: group.updatedAt.toISOString(),
      },
    };
  }

  private parseDisplayNameFilter(filter?: string): string | null {
    if (!filter) return null;
    const match = filter.match(/^displayName\s+eq\s+"([^"]+)"$/);
    return match?.[1] ?? null;
  }

  private extractMemberIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (m): m is { value: string } =>
          typeof m === "object" &&
          m !== null &&
          "value" in m &&
          typeof (m as { value: unknown }).value === "string",
      )
      .map((m) => (m as { value: string }).value);
  }

  /**
   * What a `replace` operation asks us to do about membership.
   *
   * Absent is not the same as empty. An IdP replacing an unrelated attribute,
   * or renaming a group with the no-path form Entra ID writes, sends no member
   * list at all — collapsing that to `[]` reads it as "this group should have
   * no members" and revokes access for everyone in it. An explicit `members: []`
   * genuinely does mean clear the group, so the two have to stay distinguishable.
   *
   * Naming `members` is not enough on its own: the value has to actually be a
   * list. A missing or malformed one (`{"op":"replace","path":"members"}`, or a
   * string where an array belongs) states no membership we can act on, and
   * reading it as "clear the group" turns a malformed payload into revoked
   * access. Only `null` is honoured as a written-out empty list.
   *
   * `malformed` and `absent` both leave membership alone, but they are told
   * apart so the logs can be: one is a payload worth fixing, the other is an
   * ordinary operation that simply had nothing to say about members.
   */
  private extractRequestedMemberIds(
    operation: ScimPatchOperation,
  ): MemberInstruction {
    if (operation.path === "members")
      return this.readMemberList(operation.value);

    if (
      !operation.path &&
      typeof operation.value === "object" &&
      operation.value !== null &&
      "members" in operation.value
    ) {
      return this.readMemberList(
        (operation.value as Record<string, unknown>).members,
      );
    }

    return { kind: "absent" };
  }

  /** A written-out member list, or `malformed` when the value is not one. */
  private readMemberList(value: unknown): MemberInstruction {
    if (value === null) return { kind: "list", ids: [] };
    if (!Array.isArray(value)) return { kind: "malformed" };

    const ids = this.extractMemberIds(value);
    // A list we only partly understood is not a list we can act on. The entries
    // that fell out are precisely the members that would then be removed, so
    // reading `[{"display":"Alice"}]` as "this group has no members" empties the
    // group over a payload that plainly meant to name somebody. Only a list
    // written out as empty may clear it.
    if (ids.length !== value.length) return { kind: "malformed" };

    // A blank id is well-formed enough to survive the check above and still
    // names nobody: `[{"value":""}]` matches no member, so every current member
    // falls outside the requested set and is removed. An id that refers to
    // someone outside the organization is a different matter and stays allowed
    // — that is a membership question, resolved later. This is a shape problem.
    if (ids.some((id) => id.trim() === "")) return { kind: "malformed" };

    return { kind: "list", ids };
  }

  private extractMemberIdsFromPath(path: string, value: unknown): string[] {
    // Okta: members[value eq "userId"]
    const match = path.match(/members\[value\s+eq\s+"([^"]+)"\]/);
    if (match?.[1]) return [match[1]];
    return this.extractMemberIds(value);
  }

  private scimError({
    status,
    detail,
  }: {
    status: string;
    detail: string;
  }): ScimError {
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status,
      detail,
    };
  }
}
