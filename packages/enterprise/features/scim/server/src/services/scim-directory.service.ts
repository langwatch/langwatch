// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { SYSTEM_ACTORS } from "@langwatch/actor";
import { ScimProtocolError } from "@langwatch/enterprise-scim-contract";
import type {
  ScimCreateGroupRequest,
  ScimGroup,
  ScimListResponse,
  ScimPatchRequest,
  ScimReplaceGroupRequest,
} from "@langwatch/enterprise-scim-contract";
import { ScimGrantsService } from "./scim-grants.service";
import {
  ScimGroupMembershipService,
  type ScimGroupMembershipRepository,
} from "./scim-group-membership.service";
import type { ScimGroupRecord, ScimRepositoryPort } from "../ports/scim-repository.port";

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
  ScimRepositoryPort,
  | "createGroup"
  | "deleteGroup"
  | "listGroupMemberIds"
  | "listGroupMembers"
  | "listGroups"
  | "listRoleBindings"
  | "renameGroup"
  | "tryFindGroup"
> &
  ScimGroupMembershipRepository;

export class ScimDirectoryService {
  private readonly prisma: ScimDirectoryRepository;
  private readonly grants: ScimGrantsService;
  private readonly membership: ScimGroupMembershipService;

  private constructor({
    prisma,
    grants,
  }: {
    prisma: ScimDirectoryRepository;
    grants: ScimGrantsService;
  }) {
    this.prisma = prisma;
    this.grants = grants;
    this.membership = ScimGroupMembershipService.create(prisma);
  }

  static create(options: {
    prisma: ScimDirectoryRepository;
    grants: ScimGrantsService;
  }): ScimDirectoryService {
    return new ScimDirectoryService(options);
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

    const { rows: groups, total: totalCount } = await this.prisma.listGroups({
      organizationId,
      displayName: displayNameFilter ?? undefined,
      startIndex,
      count,
    });

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: totalCount,
      startIndex,
      itemsPerPage: count,
      Resources: groups.map((g) => this.toScimGroup(g, g.members, excludeMembers)),
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
  }): Promise<ScimGroup> {
    const group = await this.tryFindGroup({ externalScimId, organizationId });
    if (!group) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    const members = await this.prisma.listGroupMembers({ groupId: group.id });

    return this.toScimGroup(group, members, excludeMembers);
  }

  async createGroup({
    request,
    organizationId,
  }: {
    request: ScimCreateGroupRequest;
    organizationId: string;
  }): Promise<ScimGroup> {
    const existing = await this.prisma.listGroups({
      organizationId,
      displayName: request.displayName,
      startIndex: 1,
      count: 1,
    });
    if (existing.total > 0) {
      return this.scimError({
        status: "409",
        detail: "A group with this name already exists",
      });
    }

    const slug = await this.membership.uniqueSlug({
      organizationId,
      name: request.displayName,
    });
    const group = await this.prisma.createGroup({
      organizationId,
      name: request.displayName,
      slug,
      externalId: (request as { externalId?: string }).externalId ?? null,
    });

    if (request.members?.length) {
      await this.membership.add({
        groupId: group.id,
        organizationId,
        memberIds: request.members.map((m) => m.value),
      });
    }

    const members = await this.prisma.listGroupMembers({ groupId: group.id });

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
  }): Promise<ScimGroup> {
    const group = await this.tryFindGroup({ externalScimId, organizationId });
    if (!group) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    if (request.displayName !== group.name) {
      await this.prisma.renameGroup({ id: group.id, name: request.displayName });
    }

    await this.membership.replace({
      group,
      organizationId,
      memberIds: (request.members ?? []).map((member) => member.value),
    });

    const updatedGroup = (await this.tryFindGroup({ externalScimId, organizationId }))!;
    const members = await this.prisma.listGroupMembers({ groupId: group.id });

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
  }): Promise<ScimGroup> {
    const group = await this.tryFindGroup({ externalScimId, organizationId });
    if (!group) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    for (const operation of patchRequest.Operations) {
      await this.membership.applyPatch({ group, operation, organizationId });
    }

    const updatedGroup = (await this.tryFindGroup({ externalScimId, organizationId }))!;
    const members = await this.prisma.listGroupMembers({ groupId: group.id });

    return this.toScimGroup(updatedGroup, members);
  }

  async deleteGroup({
    externalScimId,
    organizationId,
  }: {
    externalScimId: string;
    organizationId: string;
  }): Promise<void> {
    const group = await this.tryFindGroup({ externalScimId, organizationId });
    if (!group) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    // The grants the group carried go first and carry instant enforcement:
    // an IdP that deletes a group has taken that access away. Reconciled to
    // the empty set, so a repeated delete emits nothing.
    await this.grants.reconcile({
      scope: { kind: "group", organizationId, groupId: group.id },
      desired: [],
      actor: { type: "system", id: SYSTEM_ACTORS.scim },
    });
    await this.membership.remove({
      groupId: group.id,
      userIds: await this.prisma.listGroupMemberIds({ groupId: group.id }),
    });
    await this.prisma.deleteGroup({ id: group.id });

    return;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async tryFindGroup({
    externalScimId,
    organizationId,
  }: {
    externalScimId: string;
    organizationId: string;
  }): Promise<ScimGroupRecord | null> {
    return this.prisma.tryFindGroup({ id: externalScimId, organizationId });
  }

  private toScimGroup(
    group: ScimGroupRecord,
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
    if (!filter) {
      return null;
    }
    const match = filter.match(/^displayName\s+eq\s+"([^"]+)"$/);
    return match?.[1] ?? null;
  }

  private scimError({ status, detail }: { status: string; detail: string }): never {
    throw new ScimProtocolError({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status,
      detail,
    });
  }
}
