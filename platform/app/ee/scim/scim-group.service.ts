// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { SYSTEM_ACTORS } from "@langwatch/actor";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";

import type { Group, PrismaClient } from "~/generated/prisma/client";
import {
  type GrantsLedgerWriter,
  grantsLedgerWriter,
} from "~/server/app-layer/authz/ledger";
import { KSUID_RESOURCES } from "~/utils/constants";
import { slugify } from "~/utils/slugify";

import { ScimWriteOutsideConnectionError } from "./errors";
import type {
  ScimCreateGroupRequest,
  ScimError,
  ScimGroup,
  ScimListResponse,
  ScimPatchOperation,
  ScimPatchRequest,
  ScimReplaceGroupRequest,
} from "./scim.types";
import { ScimDirectoryIdentityService } from "./scim-directory-identity.service";
import { parseScimFilter } from "./scim-filter";
import {
  reconcileScimGrants,
  retireScimMembershipGrants,
} from "./scim-grants.reconciler";
import { scimGrantsWritePathEnabled } from "./scim-grants-flag";
import { assertScimOrganizationId } from "./scim-organization-scope";

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
  readonly #directoryIdentity: ScimDirectoryIdentityService;

  constructor({
    prisma,
    writer = grantsLedgerWriter(),
  }: {
    prisma: PrismaClient;
    writer?: GrantsLedgerWriter;
  }) {
    this.prisma = prisma;
    this.writer = writer;
    this.#directoryIdentity = ScimDirectoryIdentityService.create(prisma);
  }

  static create(options: {
    prisma: PrismaClient;
    writer?: GrantsLedgerWriter;
  }): ScimGroupService {
    return new ScimGroupService(options);
  }

  async listGroups({
    organizationId,
    connectionId = null,
    filter,
    startIndex = 1,
    count = 100,
    excludeMembers = false,
  }: {
    organizationId: string;
    connectionId?: string | null;
    filter?: string;
    startIndex?: number;
    count?: number;
    excludeMembers?: boolean;
  }): Promise<ScimListResponse<ScimGroup> | ScimError> {
    assertScimOrganizationId(organizationId);
    const parsed = parseScimFilter({
      filter,
      supported: ["displayName", "externalId"],
    });
    if (!parsed.ok) {
      return {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "400",
        scimType: "invalidFilter",
        detail: parsed.detail,
      };
    }
    const term = parsed.term;

    const where = {
      organizationId,
      // Legacy tokens retain organization-wide reach; scoped tokens also see legacy groups.
      ...(connectionId === null
        ? {}
        : {
            OR: [
              { scimConnectionId: connectionId },
              { scimConnectionId: null },
            ],
          }),
      scimSource: { not: null as string | null },
      ...(term?.attribute === "displayName"
        ? { name: { equals: term.value, mode: "insensitive" as const } }
        : {}),
      // An `externalId` term narrows to the group the directory means. A
      // value this organization has never pushed narrows to nobody rather
      // than widening back to every group — the same rule the people
      // listing follows.
      ...(term?.attribute === "externalId" ? { externalId: term.value } : {}),
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
        // `createdAt` alone leaves groups made in the same instant in an
        // order the store picks, and two pages cut from two different such
        // orders overlap. The id settles the tie.
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.prisma.group.count({ where }),
    ]);

    const resources = groups.map((g) =>
      this.toScimGroup(g, g.members, excludeMembers),
    );
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: totalCount,
      startIndex,
      // What this page holds, not what was asked for (RFC 7644 §3.4.2.4).
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  async getGroup({
    scimResourceId,
    organizationId,
    connectionId = null,
    excludeMembers = false,
  }: {
    scimResourceId: string;
    organizationId: string;
    connectionId?: string | null;
    excludeMembers?: boolean;
  }): Promise<ScimGroup | ScimError> {
    assertScimOrganizationId(organizationId);
    const group = await this.findGroup({
      scimResourceId,
      organizationId,
      connectionId,
    });
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
    connectionId = null,
  }: {
    request: ScimCreateGroupRequest;
    organizationId: string;
    connectionId?: string | null;
  }): Promise<ScimGroup | ScimError> {
    assertScimOrganizationId(organizationId);
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

    await this.authorizeMembers({
      organizationId,
      connectionId,
      memberIds: (request.members ?? []).map((member) => member.value),
    });
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

    const members = await this.prisma.groupMembership.findMany({
      where: { groupId: group.id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    return this.toScimGroup(group, members);
  }

  async replaceGroup({
    scimResourceId,
    organizationId,
    connectionId = null,
    request,
  }: {
    scimResourceId: string;
    organizationId: string;
    connectionId?: string | null;
    request: ScimReplaceGroupRequest;
  }): Promise<ScimGroup | ScimError> {
    assertScimOrganizationId(organizationId);
    const group = await this.findWritableGroup({
      scimResourceId,
      organizationId,
      connectionId,
    });
    if (!group)
      return this.scimError({ status: "404", detail: "Group not found" });

    const currentMembers = await this.prisma.groupMembership.findMany({
      where: { groupId: group.id },
      select: { userId: true },
    });
    await this.authorizeMembers({
      organizationId,
      connectionId,
      memberIds: [
        ...currentMembers.map((member) => member.userId),
        ...(request.members ?? []).map((member) => member.value),
      ],
    });

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
    const currentIds = new Set(currentMembers.map((member) => member.userId));

    const toAdd = [...requestedIds].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !requestedIds.has(id));

    if (toAdd.length) {
      await this.addMembers({
        groupId: group.id,
        organizationId,
        memberIds: toAdd,
      });
    }
    if (toRemove.length) {
      await this.removeMembers({
        organizationId,
        groupId: group.id,
        userIds: toRemove,
      });
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

  async updateGroup({
    scimResourceId,
    organizationId,
    connectionId = null,
    patchRequest,
  }: {
    scimResourceId: string;
    organizationId: string;
    connectionId?: string | null;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimGroup | ScimError> {
    assertScimOrganizationId(organizationId);
    const group = await this.findWritableGroup({
      scimResourceId,
      organizationId,
      connectionId,
    });
    if (!group)
      return this.scimError({ status: "404", detail: "Group not found" });

    await this.authorizeMembers({
      organizationId,
      connectionId,
      memberIds: await this.membersTouchedByPatch({
        groupId: group.id,
        operations: patchRequest.Operations,
      }),
    });

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
    scimResourceId,
    organizationId,
    connectionId = null,
  }: {
    scimResourceId: string;
    organizationId: string;
    connectionId?: string | null;
  }): Promise<ScimError | null> {
    assertScimOrganizationId(organizationId);
    const group = await this.findWritableGroup({
      scimResourceId,
      organizationId,
      connectionId,
    });
    if (!group)
      return this.scimError({ status: "404", detail: "Group not found" });

    const affectedMembers = await this.prisma.groupMembership.findMany({
      where: { groupId: group.id },
      select: { userId: true },
    });
    await this.authorizeMembers({
      organizationId,
      connectionId,
      memberIds: affectedMembers.map((member) => member.userId),
    });

    if (scimGrantsWritePathEnabled()) {
      await retireScimMembershipGrants({
        prisma: this.prisma,
        writer: this.writer,
        organizationId,
        userIds: affectedMembers.map(({ userId }) => userId),
        actor: { type: "system", id: SYSTEM_ACTORS.scim },
      });
    }

    // The grants the group carried go first and carry instant enforcement:
    // an IdP that deletes a group has taken that access away. Reconciled to
    // the empty set, so a repeated delete emits nothing.
    await reconcileScimGrants({
      prisma: this.prisma,
      writer: this.writer,
      organizationId,
      where: { principal: { type: "group", id: group.id } },
      desired: [],
      actor: { type: "system", id: SYSTEM_ACTORS.scim },
      mintBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
    });
    await this.prisma.groupMembership.deleteMany({
      where: { groupId: group.id },
    });
    await this.prisma.group.delete({ where: { id: group.id } });

    return null;
  }

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
    if (externalId) {
      const byIdentifier = await this.prisma.group.findFirst({
        where: { organizationId, scimConnectionId: connectionId, externalId },
      });
      if (byIdentifier) return byIdentifier;
    }
    // Name matching has the same reach as reads, including legacy token authority.
    return this.prisma.group.findFirst({
      where: {
        organizationId,
        name: displayName,
        scimSource: { not: null },
        ...(connectionId === null
          ? {}
          : {
              OR: [
                { scimConnectionId: connectionId },
                { scimConnectionId: null },
              ],
            }),
      },
    });
  }

  /**
   * Resource ids are our Group.id, not the directory's externalId. Concrete
   * tokens cannot read sibling groups; null tokens retain organization-wide
   * authority. Legacy groups remain visible to every token in the organization.
   */
  private async findGroup({
    scimResourceId,
    organizationId,
    connectionId,
  }: {
    scimResourceId: string;
    organizationId: string;
    connectionId: string | null;
  }): Promise<Group | null> {
    return this.prisma.group.findFirst({
      where: {
        id: scimResourceId,
        organizationId,
        ...(connectionId === null
          ? {}
          : {
              OR: [
                { scimConnectionId: connectionId },
                { scimConnectionId: null },
              ],
            }),
      },
    });
  }

  /**
   * Resolve a mutation target without turning a sibling connection's resource
   * into a misleading retryable not-found. Reads keep hiding sibling groups,
   * while writes acknowledge that the submitted service-provider id exists
   * and refuse the token's authority with the same stable 403 used for users.
   */
  private async findWritableGroup({
    scimResourceId,
    organizationId,
    connectionId,
  }: {
    scimResourceId: string;
    organizationId: string;
    connectionId: string | null;
  }): Promise<Group | null> {
    const group = await this.prisma.group.findFirst({
      where: { id: scimResourceId, organizationId },
    });
    if (!group) return null;
    if (
      connectionId === null ||
      group.scimConnectionId === null ||
      group.scimConnectionId === connectionId
    ) {
      return group;
    }

    throw new ScimWriteOutsideConnectionError();
  }

  private async authorizeMembers({
    organizationId,
    connectionId,
    memberIds,
  }: {
    organizationId: string;
    connectionId: string | null;
    memberIds: string[];
  }): Promise<void> {
    if (connectionId === null) return;
    for (const userId of new Set(memberIds)) {
      await this.#directoryIdentity.assertWritable({
        organizationId,
        connectionId,
        userId,
      });
    }
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
    organizationId,
    groupId,
    userIds,
  }: {
    groupId: string;
    userIds: string[];
    organizationId: string;
  }): Promise<void> {
    if (scimGrantsWritePathEnabled()) {
      const members = await this.prisma.groupMembership.findMany({
        where: { groupId, userId: { in: userIds } },
        select: { userId: true },
      });
      await retireScimMembershipGrants({
        prisma: this.prisma,
        writer: this.writer,
        organizationId,
        userIds: members.map(({ userId }) => userId),
        actor: { type: "system", id: SYSTEM_ACTORS.scim },
      });
    }
    await this.prisma.groupMembership.deleteMany({
      where: { groupId, userId: { in: userIds } },
    });
  }

  private async membersTouchedByPatch({
    groupId,
    operations,
  }: {
    groupId: string;
    operations: ScimPatchOperation[];
  }): Promise<string[]> {
    const memberIds = new Set<string>();
    let replacesMembers = false;

    for (const operation of operations) {
      if (operation.op === "add" && operation.path === "members") {
        this.extractMemberIds(operation.value).forEach((id) =>
          memberIds.add(id),
        );
      }
      if (operation.op === "remove" && operation.path?.startsWith("members")) {
        this.extractMemberIdsFromPath(operation.path, operation.value).forEach(
          (id) => memberIds.add(id),
        );
      }
      if (operation.op === "replace") {
        const instruction = this.extractRequestedMemberIds(operation);
        if (instruction.kind === "list") {
          instruction.ids.forEach((id) => memberIds.add(id));
          replacesMembers = true;
        }
      }
    }

    if (replacesMembers) {
      const current = await this.prisma.groupMembership.findMany({
        where: { groupId },
        select: { userId: true },
      });
      current.forEach(({ userId }) => memberIds.add(userId));
    }

    return [...memberIds];
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
      if (ids.length) {
        await this.addMembers({
          groupId: group.id,
          organizationId,
          memberIds: ids,
        });
      }
      return;
    }

    if (operation.op === "remove" && operation.path?.startsWith("members")) {
      const ids = this.extractMemberIdsFromPath(
        operation.path,
        operation.value,
      );
      if (ids.length) {
        await this.removeMembers({
          organizationId,
          groupId: group.id,
          userIds: ids,
        });
      }
      return;
    }

    if (operation.op !== "replace") return;
    await this.applyReplacePatch({ group, operation, organizationId });
  }

  private async applyReplacePatch({
    group,
    operation,
    organizationId,
  }: {
    group: Group;
    operation: ScimPatchOperation;
    organizationId: string;
  }): Promise<void> {
    if (
      operation.path === "displayName" &&
      typeof operation.value === "string"
    ) {
      await this.renameGroup(group.id, operation.value);
      return;
    }

    const renamed = await this.renameFromValue(group.id, operation);
    const instruction = this.extractRequestedMemberIds(operation);
    if (instruction.kind !== "list") {
      this.warnIgnoredReplace({
        groupId: group.id,
        path: operation.path,
        instruction,
        renamed,
      });
      return;
    }

    await this.replaceMembers({
      groupId: group.id,
      organizationId,
      memberIds: instruction.ids,
    });
  }

  private async renameFromValue(
    groupId: string,
    operation: ScimPatchOperation,
  ): Promise<boolean> {
    if (
      operation.path ||
      operation.value === null ||
      typeof operation.value !== "object"
    ) {
      return false;
    }

    const displayName = (operation.value as Record<string, unknown>)
      .displayName;
    if (typeof displayName !== "string") return false;

    await this.renameGroup(groupId, displayName);
    return true;
  }

  private async renameGroup(
    groupId: string,
    displayName: string,
  ): Promise<void> {
    await this.prisma.group.update({
      where: { id: groupId },
      data: { name: displayName },
    });
  }

  private warnIgnoredReplace({
    groupId,
    path,
    instruction,
    renamed,
  }: {
    groupId: string;
    path: string | undefined;
    instruction: Exclude<MemberInstruction, { kind: "list" }>;
    renamed: boolean;
  }): void {
    if (instruction.kind === "malformed") {
      logger.warn(
        { groupId, path },
        "SCIM group replace named members but did not give a list; membership left unchanged",
      );
    } else if (!renamed) {
      logger.warn(
        { groupId, path },
        "SCIM group replace matched no known attribute; leaving the group unchanged",
      );
    }
  }

  private async replaceMembers({
    groupId,
    organizationId,
    memberIds,
  }: {
    groupId: string;
    organizationId: string;
    memberIds: string[];
  }): Promise<void> {
    const current = await this.prisma.groupMembership.findMany({
      where: { groupId },
    });
    const requestedIds = new Set(memberIds);
    const currentIds = new Set(current.map(({ userId }) => userId));
    const toAdd = memberIds.filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !requestedIds.has(id));

    if (toAdd.length) {
      await this.addMembers({ groupId, organizationId, memberIds: toAdd });
    }
    if (toRemove.length) {
      await this.removeMembers({ organizationId, groupId, userIds: toRemove });
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
    members: {
      userId: string;
      user: { id: string; email: string | null; name: string | null };
    }[],
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
