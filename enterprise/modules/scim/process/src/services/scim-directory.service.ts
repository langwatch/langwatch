// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  ScimProtocolError,
  ScimWriteOutsideConnectionError,
} from "@langwatch/enterprise-scim-contract";
import type {
  ScimCreateGroupRequest,
  ScimGroup,
  ScimListResponse,
  ScimPatchRequest,
  ScimReplaceGroupRequest,
} from "@langwatch/enterprise-scim-contract";

import type { ScimGroupRecord, ScimRepository } from "../repositories/scim.repository.ts";
import { parseScimFilter } from "../rules/scim-filter.rules.ts";
import { assertScimOrganizationId } from "../rules/scim-organization-scope.rules.ts";
import type { ScimDirectoryIdentityService } from "./scim-directory-identity.service.ts";
import type { ScimGrantsService } from "./scim-grants.service.ts";
import {
  ScimGroupMembershipService,
  type ScimGroupMembershipRepository,
} from "./scim-group-membership.service.ts";

/**
 * Handles SCIM 2.0 Group resources backed by the Group / GroupMembership tables.
 * Groups pushed from an IdP arrive here unmapped — admins assign role bindings
 * via the Groups settings page.
 */
/**
 * The group half of the SCIM repository. The directory never touches users,
 * memberships, tokens or directory identities, so asking for the whole port is
 * what forced every group-only double in this package to cast.
 */
export type ScimDirectoryRepository = Pick<
  ScimRepository,
  | "createGroup"
  | "deleteGroup"
  | "findGroupMemberIds"
  | "findGroupMembers"
  | "listGroups"
  | "findRoleBindings"
  | "renameGroup"
  | "findGroup"
  | "findGroupByExternalId"
> &
  ScimGroupMembershipRepository;

/** The one thing the directory asks of the identity mapping: may this
 *  connection write to this person at all. */
export type ScimGroupMemberAuthority = Pick<ScimDirectoryIdentityService, "assertWritable">;

export class ScimDirectoryService {
  private readonly prisma: ScimDirectoryRepository;
  private readonly grants: ScimGrantsService;
  private readonly membership: ScimGroupMembershipService;
  private readonly identities: ScimGroupMemberAuthority;

  private constructor({
    prisma,
    grants,
    identities,
    provenOffboarding,
  }: {
    prisma: ScimDirectoryRepository;
    grants: ScimGrantsService;
    identities: ScimGroupMemberAuthority;
    provenOffboarding: boolean;
  }) {
    this.prisma = prisma;
    this.grants = grants;
    this.identities = identities;
    this.membership = ScimGroupMembershipService.create({
      repository: prisma,
      grants,
      provenOffboarding,
    });
  }

  static create(options: {
    prisma: ScimDirectoryRepository;
    grants: ScimGrantsService;
    identities: ScimGroupMemberAuthority;
    /** `SCIM_V2_GRANTS`, which decides whether a group's grant is what carries
     *  membership — and so whether leaving one retires a duplicate. */
    provenOffboarding: boolean;
  }): ScimDirectoryService {
    return new ScimDirectoryService(options);
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
    /** Whose groups are in reach, and whose `externalId` namespace the filter
     *  reads against. A legacy token (null) keeps organization-wide reach. */
    connectionId?: string | null;
    filter?: string;
    startIndex?: number;
    count?: number;
    excludeMembers?: boolean;
  }): Promise<ScimListResponse<ScimGroup>> {
    assertScimOrganizationId(organizationId);
    const parsed = parseScimFilter({ filter, supported: ["displayName", "externalId"] });
    if (!parsed.ok) {
      return this.scimError({ status: "400", scimType: "invalidFilter", detail: parsed.detail });
    }

    const term = parsed.term;
    const { rows: groups, total: totalCount } = await this.prisma.listGroups({
      organizationId,
      connectionId,
      ...(term?.attribute === "displayName" ? { displayName: term.value } : {}),
      // A value this organization has never pushed narrows to nobody rather
      // than widening back to every group — the people listing's own rule.
      ...(term?.attribute === "externalId" ? { externalId: term.value } : {}),
      startIndex,
      count,
    });
    const resources = groups.map((g) => this.toScimGroup(g, g.members, excludeMembers));

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
    externalScimId,
    organizationId,
    connectionId = null,
    excludeMembers = false,
  }: {
    externalScimId: string;
    organizationId: string;
    connectionId?: string | null;
    excludeMembers?: boolean;
  }): Promise<ScimGroup> {
    const group = await this.findGroup({ externalScimId, organizationId, connectionId });
    if (!group) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    const members = await this.prisma.findGroupMembers({ groupId: group.id });

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
  }): Promise<ScimGroup> {
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
      connectionId,
      memberIds: (request.members ?? []).map((member) => member.value),
    });
    const slug = await this.membership.uniqueSlug({
      organizationId,
      name: request.displayName,
    });
    const group = await this.prisma.createGroup({
      organizationId,
      name: request.displayName,
      slug,
      externalId: request.externalId ?? null,
      connectionId,
    });

    if (request.members?.length) {
      await this.membership.add({
        groupId: group.id,
        organizationId,
        memberIds: request.members.map((m) => m.value),
      });
    }

    const members = await this.prisma.findGroupMembers({ groupId: group.id });

    return this.toScimGroup(group, members);
  }

  async replaceGroup({
    externalScimId,
    organizationId,
    connectionId = null,
    request,
  }: {
    externalScimId: string;
    organizationId: string;
    connectionId?: string | null;
    request: ScimReplaceGroupRequest;
  }): Promise<ScimGroup> {
    const group = await this.findWritableGroup({ externalScimId, organizationId, connectionId });
    if (!group) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    // A replacement writes to whoever it leaves out as much as to whoever it
    // names, so the members already in the group are authorized too.
    await this.authorizeMembers({
      connectionId,
      memberIds: [
        ...(await this.prisma.findGroupMemberIds({ groupId: group.id })),
        ...(request.members ?? []).map((member) => member.value),
      ],
    });
    if (request.displayName !== group.name) {
      await this.prisma.renameGroup({ id: group.id, name: request.displayName });
    }

    await this.membership.replace({
      group,
      organizationId,
      memberIds: (request.members ?? []).map((member) => member.value),
    });

    const updatedGroup = (await this.findGroup({ externalScimId, organizationId, connectionId }))!;
    const members = await this.prisma.findGroupMembers({ groupId: group.id });

    return this.toScimGroup(updatedGroup, members);
  }

  async updateGroup({
    externalScimId,
    organizationId,
    connectionId = null,
    patchRequest,
  }: {
    externalScimId: string;
    organizationId: string;
    connectionId?: string | null;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimGroup> {
    const group = await this.findWritableGroup({ externalScimId, organizationId, connectionId });
    if (!group) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    // Every operation is authorized before any of them is applied: a patch
    // naming one person this directory owns and one it does not writes neither.
    await this.authorizeMembers({
      connectionId,
      memberIds: await this.membership.membersTouchedByPatch({
        groupId: group.id,
        operations: patchRequest.Operations,
      }),
    });

    for (const operation of patchRequest.Operations) {
      await this.membership.applyPatch({ group, operation, organizationId });
    }

    const updatedGroup = (await this.findGroup({ externalScimId, organizationId, connectionId }))!;
    const members = await this.prisma.findGroupMembers({ groupId: group.id });

    return this.toScimGroup(updatedGroup, members);
  }

  async deleteGroup({
    externalScimId,
    organizationId,
    connectionId = null,
  }: {
    externalScimId: string;
    organizationId: string;
    connectionId?: string | null;
  }): Promise<void> {
    const group = await this.findWritableGroup({ externalScimId, organizationId, connectionId });
    if (!group) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    // Deleting a group unmembers everyone in it, so a directory that does not
    // own one of them may not delete it — asked before anything is written.
    const memberIds = await this.prisma.findGroupMemberIds({ groupId: group.id });
    await this.authorizeMembers({ connectionId, memberIds });

    // The grants the group carried go first and carry instant enforcement:
    // an IdP that deletes a group has taken that access away. Reconciled to
    // the empty set, so a repeated delete emits nothing.
    await this.grants.reconcile({
      scope: { kind: "group", organizationId, groupId: group.id },
      desired: [],
      actor: { type: "system", id: SYSTEM_ACTORS.scim },
    });
    await this.membership.remove({ groupId: group.id, organizationId, userIds: memberIds });
    await this.prisma.deleteGroup({ id: group.id });

    return;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * A read hides a sibling connection's group. A legacy token (null) keeps
   * organization-wide reach, and a group that predates connection scoping
   * stays visible to every token in the organization.
   */
  private async findGroup({
    externalScimId,
    organizationId,
    connectionId,
  }: {
    externalScimId: string;
    organizationId: string;
    connectionId: string | null;
  }): Promise<ScimGroupRecord | null> {
    const group = await this.prisma.findGroup({ id: externalScimId, organizationId });

    return group && this.withinReach({ group, connectionId }) ? group : null;
  }

  /**
   * A write acknowledges that the submitted id exists and refuses the token's
   * authority, rather than answering a misleading retryable not-found.
   */
  private async findWritableGroup({
    externalScimId,
    organizationId,
    connectionId,
  }: {
    externalScimId: string;
    organizationId: string;
    connectionId: string | null;
  }): Promise<ScimGroupRecord | null> {
    const group = await this.prisma.findGroup({ id: externalScimId, organizationId });
    if (!group) return null;
    if (this.withinReach({ group, connectionId })) return group;

    throw new ScimWriteOutsideConnectionError();
  }

  private withinReach({
    group,
    connectionId,
  }: {
    group: ScimGroupRecord;
    connectionId: string | null;
  }): boolean {
    return (
      connectionId === null || group.connectionId === null || group.connectionId === connectionId
    );
  }

  /**
   * The group a push is about, before one exists: the directory's own
   * identifier first and the display name second, so a group renamed in the
   * directory stays one group rather than arriving as a second.
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
  }): Promise<ScimGroupRecord | null> {
    if (externalId) {
      const byIdentifier = await this.prisma.findGroupByExternalId({
        organizationId,
        connectionId,
        externalId,
      });
      if (byIdentifier) return byIdentifier;
    }

    const byName = await this.prisma.listGroups({
      organizationId,
      connectionId,
      displayName,
      startIndex: 1,
      count: 1,
    });

    return byName.rows[0] ?? null;
  }

  /** A scoped connection may only name people its own directory asserted. */
  private async authorizeMembers({
    connectionId,
    memberIds,
  }: {
    connectionId: string | null;
    memberIds: string[];
  }): Promise<void> {
    if (connectionId === null) return;

    for (const userId of new Set(memberIds)) {
      await this.identities.assertWritable({ connectionId, userId });
    }
  }

  private toScimGroup(
    group: ScimGroupRecord,
    members: {
      userId: string;
      user: { id: string; email: string | null; name: string | null };
    }[],
    excludeMembers = false,
  ): ScimGroup {
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: group.id,
      // Echoed when we hold one: a directory that sent an externalId and never
      // got it back cannot tell that we kept it.
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
        created: group.createdAt.toString({ fractionalSecondDigits: 3 }),
        lastModified: group.updatedAt.toString({ fractionalSecondDigits: 3 }),
      },
    };
  }

  private scimError({
    status,
    detail,
    scimType,
  }: {
    status: string;
    detail: string;
    scimType?: string;
  }): never {
    throw new ScimProtocolError({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status,
      detail,
      ...(scimType === undefined ? {} : { scimType }),
    });
  }
}
