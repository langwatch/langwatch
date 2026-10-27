/** Which keys a caller sees by membership, and the existence checks every by-id path shares. */
import type { VirtualKeyWithScopes } from "@langwatch/gateway-contract";
import { VirtualKeyNotFoundError } from "@langwatch/gateway-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { VirtualKeyAuthorizationRepository } from "../../../repositories/virtual-key-authorization.repository.ts";
import {
  isMemberNotFound,
  seatSharesOrganizationKeys,
} from "../../../rules/gateway-organization-peer.rules.ts";
import type {
  MembershipSet,
  Scope,
  VirtualKeyReader,
} from "./virtual-key-authorization.service.ts";

export class VirtualKeyMembershipService {
  static create(input: {
    directory: VirtualKeyAuthorizationRepository;
    organizations: Pick<OrganizationApi, "getMember" | "findMemberTeamIds">;
    projects: Pick<ProjectApi, "findIdentity">;
  }): VirtualKeyMembershipService {
    return new VirtualKeyMembershipService(input.directory, input.organizations, input.projects);
  }

  private constructor(
    private readonly directory: VirtualKeyAuthorizationRepository,
    private readonly organizations: Pick<OrganizationApi, "getMember" | "findMemberTeamIds">,
    private readonly projects: Pick<ProjectApi, "findIdentity">,
  ) {}

  /** The role an enabled member holds here; none for a stranger or a disabled seat. */
  private async enabledRole(input: {
    organizationId: string;
    userId: string;
  }): Promise<{ role: string } | null> {
    try {
      const member = await this.organizations.getMember(input);

      return member.disabledAt === null ? { role: member.role } : null;
    } catch (error) {
      if (isMemberNotFound(error)) return null;

      throw error;
    }
  }

  async loadMembershipSet(input: {
    organizationId: string;
    userId: string;
  }): Promise<MembershipSet> {
    const [organizationRole, memberTeamIds] = await Promise.all([
      this.enabledRole(input),
      this.organizations.findMemberTeamIds(input),
    ]);
    const teamIds = new Set(memberTeamIds);
    const projectIds =
      teamIds.size > 0
        ? await this.directory.findProjectIdsForTeams({ teamIds: [...teamIds] })
        : [];

    return {
      isOrgMember: organizationRole !== null && seatSharesOrganizationKeys(organizationRole.role),
      isOrgAdmin: organizationRole?.role === "ADMIN",
      teamIds,
      projectIds: new Set(projectIds),
    };
  }

  /**
   * What a credential acting in one project reads keys as: organization-wide keys, its team's and
   * its own, never a sibling team's. An unknown project reaches organization-wide keys only.
   */
  async membershipOfProject(projectId: string): Promise<MembershipSet> {
    const project = await this.projects.findIdentity(projectId);

    return {
      isOrgMember: true,
      isOrgAdmin: false,
      teamIds: new Set(project ? [project.teamId] : []),
      projectIds: new Set([projectId]),
    };
  }

  isVisibleToMembership(membership: MembershipSet, scopes: Scope[]): boolean {
    // Org admins manage the whole org, so list/get visibility mirrors the
    // permission cascade — list/get only ever pass VKs already scoped to the
    // caller's org, so a blanket true here can't leak another org's keys.
    // Without it, the auto-provisioned per-project Langy VK is invisible to
    // the very admin who owns it (real admins hold no per-team TeamUser rows).
    if (membership.isOrgAdmin) {
      return true;
    }

    return scopes.some((scope) => {
      if (scope.scopeType === "ORGANIZATION") {
        return membership.isOrgMember;
      }

      if (scope.scopeType === "TEAM") {
        return membership.teamIds.has(scope.scopeId);
      }

      return membership.projectIds.has(scope.scopeId);
    });
  }

  /**
   * Precondition every by-id mutation shares: the key must exist. Authorization is a separate,
   * permission-based decision on the returned key's scopes, so this deliberately does not filter
   * by visibility — a scope role-binding holder can operate on a key membership never surfaces.
   */
  async getExistingVk(
    reader: VirtualKeyReader,
    id: string,
    organizationId: string,
  ): Promise<VirtualKeyWithScopes> {
    const vk = await reader.findById(id, organizationId);
    if (!vk) {
      throw new VirtualKeyNotFoundError();
    }

    return vk;
  }

  /**
   * Precondition every by-id read shares: the key must exist and fall inside the caller's
   * membership set. Both answer not-found, since a distinguishable forbidden would be an existence
   * oracle. The membership set is derived per door, but the check itself is shared.
   */
  async getVisibleVk(
    reader: VirtualKeyReader,
    membership: MembershipSet,
    { id, organizationId }: { id: string; organizationId: string },
  ): Promise<VirtualKeyWithScopes> {
    const vk = await this.getExistingVk(reader, id, organizationId);
    if (!this.isVisibleToMembership(membership, vk.scopes)) {
      throw new VirtualKeyNotFoundError();
    }

    return vk;
  }
}
