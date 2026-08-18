// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { Group, PrismaClient } from "~/generated/prisma/client";
import {
  type GrantsLedgerWriter,
  grantsLedgerWriter,
} from "~/server/app-layer/authz/ledger";
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
          members: {
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
    externalScimId,
    organizationId,
    excludeMembers = false,
  }: {
    externalScimId: string;
    organizationId: string;
    excludeMembers?: boolean;
  }): Promise<ScimGroup | ScimError> {
    const group = await this.findGroup({ externalScimId, organizationId });
    if (!group)
      return this.scimError({ status: "404", detail: "Group not found" });

    const members = await this.prisma.groupMembership.findMany({
      where: { groupId: group.id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    return this.toScimGroup(group, members, excludeMembers);
  }

  async createGroup({
    request,
    organizationId,
  }: {
    request: ScimCreateGroupRequest;
    organizationId: string;
  }): Promise<ScimGroup | ScimError> {
    const existing = await this.prisma.group.findFirst({
      where: {
        organizationId,
        name: request.displayName,
        scimSource: { not: null },
      },
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
        externalId: (request as { externalId?: string }).externalId ?? null,
      },
    });

    if (request.members?.length) {
      await this.addMembers({
        groupId: group.id,
        organizationId,
        memberIds: request.members.map((m) => m.value),
      });
    }

    const members = await this.prisma.groupMembership.findMany({
      where: { groupId: group.id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    return this.toScimGroup(group, members);
  }

  async replaceGroup({
    externalScimId,
    organizationId,
    request,
  }: {
    externalScimId: string;
    organizationId: string;
    request: ScimReplaceGroupRequest;
  }): Promise<ScimGroup | ScimError> {
    const group = await this.findGroup({ externalScimId, organizationId });
    if (!group)
      return this.scimError({ status: "404", detail: "Group not found" });

    if (request.displayName !== group.name) {
      await this.prisma.group.update({
        where: { id: group.id },
        data: { name: request.displayName },
      });
    }

    const requestedIds = new Set((request.members ?? []).map((m) => m.value));
    const current = await this.prisma.groupMembership.findMany({
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
      await this.removeMembers({ groupId: group.id, userIds: toRemove });

    const updatedGroup = await this.prisma.group.findUniqueOrThrow({
      where: { id: group.id },
    });
    const members = await this.prisma.groupMembership.findMany({
      where: { groupId: group.id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    return this.toScimGroup(updatedGroup, members);
  }

  async updateGroup({
    externalScimId,
    organizationId,
    patchRequest,
  }: {
    externalScimId: string;
    organizationId: string;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimGroup | ScimError> {
    const group = await this.findGroup({ externalScimId, organizationId });
    if (!group)
      return this.scimError({ status: "404", detail: "Group not found" });

    for (const operation of patchRequest.Operations) {
      await this.applyPatch({ group, operation, organizationId });
    }

    const updatedGroup = await this.prisma.group.findUniqueOrThrow({
      where: { id: group.id },
    });
    const members = await this.prisma.groupMembership.findMany({
      where: { groupId: group.id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    return this.toScimGroup(updatedGroup, members);
  }

  async deleteGroup({
    externalScimId,
    organizationId,
  }: {
    externalScimId: string;
    organizationId: string;
  }): Promise<ScimError | null> {
    const group = await this.findGroup({ externalScimId, organizationId });
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
      actor: { type: "system", id: "system:scim" },
      mintBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
    });
    await this.prisma.groupMembership.deleteMany({
      where: { groupId: group.id },
    });
    await this.prisma.group.delete({ where: { id: group.id } });

    return null;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async findGroup({
    externalScimId,
    organizationId,
  }: {
    externalScimId: string;
    organizationId: string;
  }): Promise<Group | null> {
    return this.prisma.group.findFirst({
      where: { id: externalScimId, organizationId },
    });
  }

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

    for (const userId of memberIds) {
      if (!validIds.has(userId)) continue;
      await this.prisma.groupMembership.upsert({
        where: { userId_groupId: { userId, groupId } },
        update: {},
        create: { userId, groupId },
      });
    }
  }

  private async removeMembers({
    groupId,
    userIds,
  }: {
    groupId: string;
    userIds: string[];
  }): Promise<void> {
    await this.prisma.groupMembership.deleteMany({
      where: { groupId, userId: { in: userIds } },
    });
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
        await this.removeMembers({ groupId: group.id, userIds: ids });
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

      const current = await this.prisma.groupMembership.findMany({
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
        await this.removeMembers({ groupId: group.id, userIds: toRemove });
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
