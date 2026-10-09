// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { SYSTEM_ACTORS } from "@langwatch/authorization";
import type { AuthzGrantsService, GrantScopeTier, TeamUserRole } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { ScimRepository } from "../repositories/scim.repository.ts";
import { assertRemovalKeepsAnAdministrator } from "../rules/scim-last-administrator.rules.ts";
import {
  ScimDeprovisionService,
  type ScimOrganizationAdministration,
} from "./scim-deprovision.service.ts";
import type { ScimGrantsService } from "./scim-grants.service.ts";
import type { ScimSyncLifecycle } from "./scim-sync-lifecycle.service.ts";

/** What a directory push grants a person in the organization, and how a leaver loses it. */
export class ScimMembershipAccessService {
  static create(options: {
    prisma: ScimRepository;
    writer: AuthzGrantsService;
    grants: ScimGrantsService;
    lifecycle: ScimSyncLifecycle;
    organization: ScimOrganizationAdministration;
    members: Pick<OrganizationApi, "deleteMember">;
    provenOffboarding: boolean;
  }): ScimMembershipAccessService {
    return new ScimMembershipAccessService(options);
  }

  private static readonly ACTOR = {
    type: "system",
    id: SYSTEM_ACTORS.scim,
  } as const;

  private readonly prisma: ScimRepository;
  private readonly writer: AuthzGrantsService;
  private readonly grants: ScimGrantsService;
  private readonly deprovision: ScimDeprovisionService;
  private readonly organization: ScimOrganizationAdministration;
  private readonly members: Pick<OrganizationApi, "deleteMember">;
  private readonly provenOffboarding: boolean;

  private constructor({
    prisma,
    writer,
    grants,
    lifecycle,
    organization,
    members,
    provenOffboarding,
  }: {
    prisma: ScimRepository;
    writer: AuthzGrantsService;
    grants: ScimGrantsService;
    lifecycle: ScimSyncLifecycle;
    organization: ScimOrganizationAdministration;
    members: Pick<OrganizationApi, "deleteMember">;
    provenOffboarding: boolean;
  }) {
    this.prisma = prisma;
    this.writer = writer;
    this.grants = grants;
    this.deprovision = ScimDeprovisionService.create({
      grants: writer,
      lifecycle,
      organization,
    });
    this.provenOffboarding = provenOffboarding;
    this.organization = organization;
    this.members = members;
  }

  /**
   * The organization-scoped membership grant a directory push asserts,
   * reconciled rather than written: re-pushing the same state emits nothing.
   *
   * With `SCIM_V2_GRANTS` on there is nothing to assert — a group's grant is
   * what carries the access — so the push retires the duplicate an older one
   * minted instead of restating it.
   */
  async reconcileOrganizationMembership({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    if (this.provenOffboarding) {
      await this.grants.retireMembershipGrants({
        organizationId,
        userIds: [userId],
        actor: ScimMembershipAccessService.ACTOR,
      });

      return;
    }

    // A Developer seat (ADR-171) holds no organization-wide grant, so a sync asserts none for it.
    const membership = await this.prisma.findMembership({ organizationId, userId });
    const holdsOrganizationGrant = membership?.role !== "DEVELOPER";
    await this.grants.reconcile({
      scope: {
        kind: "organization-membership",
        organizationId,
        userId,
      },
      desired: holdsOrganizationGrant
        ? [
            {
              principal: { userId },
              // A Lite Member seat (EXTERNAL) is granted view only, as an invitation maps it.
              role: (membership?.role === "EXTERNAL" ? "VIEWER" : "MEMBER") as TeamUserRole,
              customRoleId: null,
              scopeType: "ORGANIZATION" as GrantScopeTier,
              scopeId: organizationId,
            },
          ]
        : [],
      actor: ScimMembershipAccessService.ACTOR,
    });
  }

  /**
   * Access in this organization goes before the resource is marked inactive,
   * and the organization's own last-administrator refusal is asked either way:
   * the flag chooses HOW access is removed, never whether an organization may
   * be left with nobody to administer it.
   */
  async removeOrganizationAccess({
    userId,
    organizationId,
    connectionId,
    op,
  }: {
    userId: string;
    organizationId: string;
    connectionId: string | null;
    op: "deactivate_user" | "delete_user";
  }): Promise<void> {
    if (this.provenOffboarding) {
      await this.deprovision.removeAccess({ userId, organizationId, connectionId, op });

      return;
    }

    const administrators = await this.organization.findActiveOrganizationAdministrators({
      organizationId,
    });
    assertRemovalKeepsAnAdministrator({ administrators, userId });
    const visibleGrants = await this.grants.findGrantRows({
      kind: "member-offboarding",
      organizationId,
      userId,
    });
    await this.writer.offboardMember({
      organizationId,
      userId,
      revokedGrantIds: visibleGrants.map((row) => row.id),
      actor: ScimMembershipAccessService.ACTOR,
    });
    // A leaver stays a member holding nothing; only a deletion takes the row.
    if (op === "delete_user") {
      await this.members.deleteMember({ organizationId, userId }, null);
    }
  }
}
