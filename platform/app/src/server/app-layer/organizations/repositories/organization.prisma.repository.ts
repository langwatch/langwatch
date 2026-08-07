import { NotFoundError, ValidationError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { TRPCError } from "@trpc/server";
import type { User } from "~/generated/prisma/client";
import {
  type Currency,
  type OrganizationIntent,
  OrganizationUserRole,
  PricingModel,
  type Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { findSharedTeamIds } from "~/server/role-bindings/personal-team-scope";
import { KSUID_RESOURCES } from "~/utils/constants";
import { encrypt } from "~/utils/encryption";
import {
  isTeamRoleAllowedForOrganizationRole,
  type TeamRoleValue,
} from "~/utils/memberRoleConstraints";
import { GROWTH_SEAT_PLAN_TYPES } from "../../../../../ee/billing/utils/growthSeatEvent";
import { isCustomRole } from "../../../api/enterprise";
import { revokeAllSessionsForUser } from "../../../better-auth/revokeSessions";
import {
  CannotRemoveSelfAsLastAdminError,
  LiteMemberViewerOnlyError,
  TeamLastAdminRequiredError,
} from "../../teams/team.service";
import type {
  AuditLogFilters,
  CreateAndAssignInput,
  CreateAndAssignResult,
  DeleteMemberInput,
  EnrichedAuditLog,
  FullyLoadedOrganization,
  OrganizationForBilling,
  OrganizationMemberWithUser,
  OrganizationRepository,
  OrganizationWithAdmins,
  OrganizationWithMembersAndTheirTeams,
  SetMemberDisabledInput,
  UpdateMemberRoleInput,
  UpdateMemberRoleResult,
  UpdateOrganizationInput,
  UpdateTeamMemberRoleInput,
} from "./organization.repository";

/**
 * The team's name for a refusal or a report, both of which are read by somebody
 * who knows the team by its name and not by its id.
 */
async function teamNameFor({
  tx,
  teamId,
}: {
  tx: Prisma.TransactionClient;
  teamId: string;
}): Promise<string | null> {
  const team = await tx.team.findUnique({
    where: { id: teamId },
    select: { name: true },
  });
  return team?.name ?? null;
}

export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getOrganizationIdByTeamId(teamId: string): Promise<string | null> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
    return team?.organizationId ?? null;
  }

  async getUserOrgRole({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<OrganizationUserRole | null> {
    const orgUser = await this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true, disabledAt: true },
    });
    // A disabled membership carries no role: this is the gate that makes
    // disabling actually revoke access rather than only free a seat.
    if (!orgUser || orgUser.disabledAt) return null;
    return orgUser.role;
  }

  async getUserOrgRoleByTeamId({
    userId,
    teamId,
  }: {
    userId: string;
    teamId: string;
  }): Promise<OrganizationUserRole | null> {
    // The Prisma multitenancy middleware rejects `OrganizationUser`
    // queries that don't pin an `organizationId` in the where clause.
    // Resolve teamId -> organizationId first, then look up the
    // membership directly — keeps the middleware happy without
    // exempting the model.
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
    if (!team) return null;
    const orgUser = await this.prisma.organizationUser.findFirst({
      where: {
        userId,
        organizationId: team.organizationId,
        disabledAt: null,
      },
      select: { role: true },
    });
    return orgUser?.role ?? null;
  }

  async getProjectIds(organizationId: string): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }

  async findWithAdmins(
    organizationId: string,
  ): Promise<OrganizationWithAdmins | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        members: {
          where: { role: "ADMIN" },
          include: {
            user: true,
          },
        },
      },
    }) as Promise<OrganizationWithAdmins | null>;
  }

  async updateSentPlanLimitAlert(
    organizationId: string,
    timestamp: Date,
  ): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { sentPlanLimitAlert: timestamp },
    });
  }

  async findProjectsWithName(
    organizationId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  async clearTrialLicense(organizationId: string): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        license: null,
        licenseExpiresAt: null,
        licenseLastValidatedAt: null,
      },
    });
  }

  async updateCurrency(input: {
    organizationId: string;
    currency: string;
  }): Promise<void> {
    await this.prisma.organization.update({
      where: { id: input.organizationId },
      data: { currency: input.currency as Currency },
    });
  }

  async getPricingModel(organizationId: string): Promise<string | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true },
    });
    return org?.pricingModel ?? null;
  }

  async getStripeCustomerId(organizationId: string): Promise<string | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { stripeCustomerId: true },
    });
    return org?.stripeCustomerId ?? null;
  }

  async findByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.organization.findFirst({
      where: { stripeCustomerId },
      select: { id: true },
    });
  }

  async findNameById(
    organizationId: string,
  ): Promise<{ id: string; name: string } | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
    return org ?? null;
  }

  async findPrimaryIntentById(
    organizationId: string,
  ): Promise<OrganizationIntent | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { primaryIntent: true },
    });
    return org?.primaryIntent ?? null;
  }

  async getOrganizationForBilling(
    organizationId: string,
  ): Promise<OrganizationForBilling | null> {
    return this.prisma.organization.findFirst({
      where: { id: organizationId, pricingModel: PricingModel.SEAT_EVENT },
      select: {
        id: true,
        stripeCustomerId: true,
        subscriptions: {
          where: {
            status: "ACTIVE",
            plan: { in: [...GROWTH_SEAT_PLAN_TYPES] },
          },
          take: 1,
          select: { id: true },
          orderBy: { startDate: "desc" },
        },
      },
    });
  }

  async createAndAssign(
    input: CreateAndAssignInput,
  ): Promise<CreateAndAssignResult> {
    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          id: input.orgId,
          name: input.orgName,
          slug: input.orgSlug,
          phoneNumber: input.phoneNumber,
          signupData: input.signUpData as Prisma.InputJsonValue | undefined,
          primaryIntent: input.primaryIntent ?? null,
          pricingModel: input.pricingModel,
        },
      });

      await tx.organizationUser.create({
        data: {
          userId: input.userId,
          organizationId: organization.id,
          role: "ADMIN",
        },
      });

      const team = await tx.team.create({
        data: {
          id: input.teamId,
          name: input.orgName,
          slug: input.teamSlug,
          organizationId: organization.id,
        },
      });

      await tx.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: organization.id,
          userId: input.userId,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organization.id,
        },
      });

      await tx.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId: organization.id,
          userId: input.userId,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: team.id,
        },
      });

      return {
        organization: { id: organization.id, name: organization.name },
        team: { id: team.id, slug: team.slug, name: team.name },
      };
    });
  }

  async getAllForUser(params: {
    userId: string;
    isDemo: boolean;
    demoProjectUserId: string;
    demoProjectId: string;
  }): Promise<FullyLoadedOrganization[]> {
    const { userId, isDemo, demoProjectId } = params;

    return this.prisma.organization.findMany({
      where: {
        OR: [
          ...(isDemo
            ? [
                {
                  teams: {
                    some: {
                      archivedAt: null,
                      projects: {
                        some: { id: demoProjectId },
                      },
                    },
                  },
                },
              ]
            : []),
          {
            // A disabled membership must not put the organization back in the
            // user's switcher, or they would see a workspace they cannot act
            // in.
            members: {
              some: {
                userId,
                disabledAt: null,
              },
            },
          },
        ],
      },
      include: {
        members: {
          where: {
            userId,
          },
        },
        teams: {
          where: {
            archivedAt: null,
          },
          include: {
            members: {
              include: {
                assignedRole: true,
              },
            },
            projects: {
              where: {
                archivedAt: null,
                // Hide the internal-governance Project from every UI consumer.
                // It exists only as a routing/tenancy artifact for IngestionSource
                // data; never user-visible. See specs/ai-gateway/governance/
                // architecture-invariants.feature + ui-contract.feature.
                kind: { not: "internal_governance" },
              },
            },
          },
        },
      },
    }) as Promise<FullyLoadedOrganization[]>;
  }

  async getOrganizationWithMembers(params: {
    organizationId: string;
    userId: string;
    includeDeactivated: boolean;
  }): Promise<OrganizationWithMembersAndTheirTeams | null> {
    const { organizationId, userId, includeDeactivated } = params;

    return this.prisma.organization.findFirst({
      where: {
        id: organizationId,
        // The caller must hold an active membership to see the organization.
        // The `members` list below is deliberately NOT filtered the same way:
        // an admin has to see who is disabled in order to re-enable them.
        members: {
          some: {
            userId,
            disabledAt: null,
          },
        },
      },
      include: {
        members: {
          ...(!includeDeactivated
            ? { where: { user: { deactivatedAt: null } } }
            : {}),
          orderBy: [
            { user: { name: "asc" } },
            { user: { email: "asc" } },
            { userId: "asc" },
          ],
          include: {
            user: {
              include: {
                teamMemberships: {
                  where: { team: { archivedAt: null } },
                  include: {
                    team: true,
                    assignedRole: true,
                  },
                },
              },
            },
          },
        },
      },
    }) as Promise<OrganizationWithMembersAndTheirTeams | null>;
  }

  async getMemberById(params: {
    organizationId: string;
    userId: string;
    currentUserId: string;
  }): Promise<OrganizationMemberWithUser | null> {
    const { organizationId, userId, currentUserId } = params;

    const currentUserMembership = await this.prisma.organizationUser.findFirst({
      where: {
        organizationId,
        userId: currentUserId,
        disabledAt: null,
      },
    });

    if (!currentUserMembership) {
      return null;
    }

    return this.prisma.organizationUser.findFirst({
      where: {
        organizationId,
        userId,
      },
      include: {
        user: {
          include: {
            teamMemberships: {
              where: { team: { archivedAt: null } },
              include: {
                team: true,
                assignedRole: true,
              },
            },
          },
        },
      },
    }) as Promise<OrganizationMemberWithUser | null>;
  }

  async getAllMembers(organizationId: string): Promise<User[]> {
    return this.prisma.user.findMany({
      where: {
        deactivatedAt: null,
        orgMemberships: {
          some: {
            organizationId,
            disabledAt: null,
          },
        },
      },
    });
  }

  async update(input: UpdateOrganizationInput): Promise<void> {
    await this.prisma.organization.update({
      where: { id: input.organizationId },
      data: {
        name: input.name,
        s3Endpoint: input.s3Endpoint ? encrypt(input.s3Endpoint) : null,
        s3AccessKeyId: input.s3AccessKeyId
          ? encrypt(input.s3AccessKeyId)
          : null,
        s3SecretAccessKey: input.s3SecretAccessKey
          ? encrypt(input.s3SecretAccessKey)
          : null,
        s3Bucket: input.s3Bucket,
        ...(input.presenceEnabled !== undefined
          ? { presenceEnabled: input.presenceEnabled }
          : {}),
        ...(input.traceSharingEnabled !== undefined
          ? { traceSharingEnabled: input.traceSharingEnabled }
          : {}),
        ...(input.supportContact !== undefined
          ? { supportContact: input.supportContact?.trim() || null }
          : {}),
        ...(input.primaryIntent !== undefined
          ? { primaryIntent: input.primaryIntent }
          : {}),
      },
    });
  }

  /**
   * Removes a membership, and the personal workspace that came with it.
   *
   * `PERSONAL_TEAM_ARCHIVE_REFUSAL` is the sentence an admin gets when they try
   * to archive a personal workspace directly, and it tells them these
   * workspaces "disappear with the member's access to the organization". That
   * was not true: the membership and its role bindings went, and the personal
   * team and project stayed behind owned by somebody who is no longer a member,
   * still holding their one slot per (organization, owner). So the refusal
   * pointed at a cleanup that never happened, and an admin asking how to get
   * rid of one had no answer at all.
   *
   * Archived, not deleted, for the same reason every other project is: the work
   * is still the work. `PersonalWorkspaceService.ensure()` reactivates this
   * exact pair if the person is invited back, which is what keeps archiving here
   * from bricking that slot.
   */
  async deleteMember(input: DeleteMemberInput): Promise<void> {
    const { organizationId, userId } = input;

    await this.prisma.$transaction(async (tx) => {
      await tx.organizationUser.delete({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
      });
      await tx.roleBinding.deleteMany({
        where: { organizationId, userId },
      });

      const archivedAt = new Date();
      const personalTeams = await tx.team.findMany({
        where: {
          organizationId,
          ownerUserId: userId,
          isPersonal: true,
          archivedAt: null,
        },
        select: { id: true },
      });
      if (personalTeams.length === 0) return;

      const personalTeamIds = personalTeams.map((team) => team.id);
      // `isPersonal` on the same terms the reactivation reads it, so the two
      // sides move the same rows. A personal team holds nothing else today
      // (creating a project in one, or moving one into it, is refused), and the
      // flag mirrors the team's, so this narrows nothing away; it keeps the pair
      // symmetric if that ever slips, since archiving what the revival would
      // not return is the failure with no way back.
      await tx.project.updateMany({
        where: {
          teamId: { in: personalTeamIds },
          isPersonal: true,
          archivedAt: null,
        },
        data: { archivedAt },
      });
      await tx.team.updateMany({
        where: { id: { in: personalTeamIds } },
        data: { archivedAt },
      });
    });
  }

  async setMemberDisabled(input: SetMemberDisabledInput): Promise<void> {
    const { organizationId, userId, disabled } = input;

    await this.prisma.$transaction(async (tx) => {
      const member = await tx.organizationUser.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
        select: { role: true },
      });

      if (!member) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      }

      // Same guard as demoting the last admin: an organization with no admin
      // who can sign in cannot be recovered from inside the product.
      if (disabled && member.role === OrganizationUserRole.ADMIN) {
        const activeAdmins = await tx.organizationUser.count({
          where: {
            organizationId,
            role: OrganizationUserRole.ADMIN,
            disabledAt: null,
          },
        });

        if (activeAdmins <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot disable the last admin of an organization",
          });
        }
      }

      await tx.organizationUser.update({
        where: { userId_organizationId: { userId, organizationId } },
        data: { disabledAt: disabled ? new Date() : null },
      });
    });

    if (disabled) {
      // Revoking the seat has to revoke the live session too, or the person
      // keeps working until their token happens to expire.
      await revokeAllSessionsForUser({ prisma: this.prisma, userId });
    }
  }

  async updateMemberRole(
    input: UpdateMemberRoleInput,
  ): Promise<UpdateMemberRoleResult> {
    const { organizationId, userId, role, effectiveTeamRoleUpdates } = input;

    // Teams whose only team-scoped admin this seat change corrected away. Not a
    // failure, and not silent either: the caller reports them to whoever made
    // the decision.
    const teamsLeftWithoutAdmin: Array<{ id: string; name: string }> = [];

    await this.prisma.$transaction(async (tx) => {
      const currentMember = await tx.organizationUser.findUnique({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
      });

      if (!currentMember) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found",
        });
      }

      if (
        role !== OrganizationUserRole.ADMIN &&
        currentMember.role === OrganizationUserRole.ADMIN
      ) {
        const adminCount = await tx.organizationUser.count({
          where: {
            organizationId,
            role: OrganizationUserRole.ADMIN,
          },
        });

        if (adminCount <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot remove the last admin from an organization",
          });
        }
      }

      await tx.organizationUser.update({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
        data: { role },
      });

      // Keep ORGANIZATION-scoped RoleBinding in sync (skip EXTERNAL)
      if (role !== OrganizationUserRole.EXTERNAL) {
        await tx.roleBinding.deleteMany({
          where: {
            organizationId,
            userId,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        });
        await tx.roleBinding.create({
          data: {
            id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
            organizationId,
            userId,
            role: role as unknown as TeamUserRole,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        });
      } else {
        // EXTERNAL (Lite Member) users have no org-level binding
        await tx.roleBinding.deleteMany({
          where: {
            organizationId,
            userId,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
        });
      }

      // Shared teams only, matching what the router resolved before it computed
      // the effective updates. The personal workspace each member gets to
      // themselves has one admin, its owner, so a downgrade that reached it
      // would trip the last-admin guard below and roll this transaction back,
      // taking the organization role change with it.
      const organizationTeamIds = await findSharedTeamIds({
        client: tx,
        organizationId,
      });

      const currentMemberships = await tx.roleBinding.findMany({
        where: {
          organizationId,
          userId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: { in: organizationTeamIds },
        },
        select: {
          scopeId: true,
          role: true,
          customRoleId: true,
        },
      });
      const currentMembershipByTeamId = new Map(
        currentMemberships.map((m) => [m.scopeId, m]),
      );

      const dedupedTeamRoleUpdates = new Map(
        effectiveTeamRoleUpdates.map((u) => [u.teamId, u]),
      );

      for (const [teamId, teamRoleUpdate] of dedupedTeamRoleUpdates.entries()) {
        const currentMembership = currentMembershipByTeamId.get(teamId);
        if (!currentMembership) {
          throw new NotFoundError(
            "team_membership_not_found",
            "TeamMember",
            userId,
          );
        }

        if (
          !isTeamRoleAllowedForOrganizationRole({
            organizationRole: role,
            teamRole: teamRoleUpdate.role as TeamRoleValue,
          })
        ) {
          throw new LiteMemberViewerOnlyError(
            await teamNameFor({ tx, teamId }),
          );
        }

        const updateIsCustomRole = isCustomRole(teamRoleUpdate.role);
        if (updateIsCustomRole && !teamRoleUpdate.customRoleId) {
          throw new ValidationError(
            "Custom role ID is required for custom role updates",
            {
              meta: {
                fieldErrors: {
                  customRoleId: ["Pick which custom role to use."],
                },
                formErrors: ["Pick which custom role to use."],
              },
            },
          );
        }

        if (updateIsCustomRole && teamRoleUpdate.customRoleId) {
          const customRole = await tx.customRole.findUnique({
            where: { id: teamRoleUpdate.customRoleId },
            select: { organizationId: true, kind: true },
          });
          if (
            customRole?.kind !== "custom" ||
            customRole.organizationId !== organizationId
          ) {
            throw new NotFoundError(
              "custom_role_not_found",
              "CustomRole",
              teamRoleUpdate.customRoleId ?? "unknown",
            );
          }
        }

        const nextRole = updateIsCustomRole
          ? TeamUserRole.CUSTOM
          : (teamRoleUpdate.role as TeamUserRole);
        const shouldClearCustomRole = !updateIsCustomRole;
        const isDemotingLastAdmin =
          currentMembership.role === TeamUserRole.ADMIN &&
          nextRole !== TeamUserRole.ADMIN;

        if (isDemotingLastAdmin) {
          const teamAdminCount = await tx.roleBinding.count({
            where: {
              organizationId,
              scopeType: RoleBindingScopeType.TEAM,
              scopeId: teamId,
              role: TeamUserRole.ADMIN,
              userId: { not: null },
            },
          });
          if (teamAdminCount <= 1) {
            // A caller who named this team asked for a team-local change, and a
            // team needs an admin. A seat correction did not name it: the
            // decision was about one person's seat, every shared team is still
            // administered through any ORGANIZATION-scoped ADMIN binding, and
            // refusing here used to roll back the organization role change too,
            // so the seat could not be changed at all while the member was
            // somebody's only team admin. It goes through, and the team is
            // reported so the admin who did it is not left to discover this.
            if (teamRoleUpdate.origin === "requested") {
              throw new TeamLastAdminRequiredError(
                await teamNameFor({ tx, teamId }),
              );
            }
            teamsLeftWithoutAdmin.push({
              id: teamId,
              name: (await teamNameFor({ tx, teamId })) ?? teamId,
            });
          }
        }

        const roleUnchanged =
          currentMembership.role === nextRole &&
          (shouldClearCustomRole
            ? currentMembership.customRoleId === null
            : currentMembership.customRoleId === teamRoleUpdate.customRoleId);
        if (roleUnchanged) continue;

        // Update TEAM-scoped RoleBinding
        await tx.roleBinding.deleteMany({
          where: {
            organizationId,
            userId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
          },
        });
        await tx.roleBinding.create({
          data: {
            id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
            organizationId,
            userId,
            role: nextRole,
            customRoleId: shouldClearCustomRole
              ? null
              : (teamRoleUpdate.customRoleId ?? null),
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
          },
        });
      }

      const finalAdminCount = await tx.organizationUser.count({
        where: {
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
      });

      if (finalAdminCount === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Operation would result in no admins for this organization",
        });
      }
    });

    return { teamsLeftWithoutAdmin };
  }

  async updateTeamMemberRole(input: UpdateTeamMemberRoleInput): Promise<void> {
    const { teamId, userId, role, customRoleId, currentUserId } = input;
    const inputIsCustomRole = customRoleId !== undefined;

    if (inputIsCustomRole && customRoleId) {
      const storedCustomRoleId = customRoleId;

      await this.prisma.$transaction(async (tx) => {
        const team = await tx.team.findUnique({
          where: { id: teamId },
          select: { organizationId: true, name: true },
        });
        if (!team) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Team not found",
          });
        }
        const customRole = await tx.customRole.findUnique({
          where: { id: storedCustomRoleId },
          select: { organizationId: true, permissions: true, kind: true },
        });
        if (
          customRole?.kind !== "custom" ||
          customRole.organizationId !== team.organizationId
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Role does not belong to team's organization",
          });
        }

        const orgMembership = await tx.organizationUser.findUnique({
          where: {
            userId_organizationId: {
              userId,
              organizationId: team.organizationId,
            },
          },
        });

        if (orgMembership?.role === OrganizationUserRole.EXTERNAL) {
          throw new LiteMemberViewerOnlyError(team.name);
        }

        const adminCount = await tx.roleBinding.count({
          where: {
            organizationId: team.organizationId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
            role: TeamUserRole.ADMIN,
            userId: { not: null },
          },
        });

        if (adminCount === 0) {
          throw new TeamLastAdminRequiredError(team.name);
        }

        const targetUserBinding = await tx.roleBinding.findFirst({
          where: {
            organizationId: team.organizationId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
            userId,
          },
          select: { role: true },
        });

        if (!targetUserBinding) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User is not a member of this team",
          });
        }

        const isTargetUserAdmin = targetUserBinding.role === TeamUserRole.ADMIN;

        if (adminCount === 1 && isTargetUserAdmin) {
          if (userId === currentUserId) {
            throw new CannotRemoveSelfAsLastAdminError(team.name);
          }

          throw new TeamLastAdminRequiredError(team.name);
        }

        await tx.roleBinding.deleteMany({
          where: {
            organizationId: team.organizationId,
            userId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
          },
        });
        await tx.roleBinding.create({
          data: {
            id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
            organizationId: team.organizationId,
            userId,
            role: TeamUserRole.CUSTOM,
            customRoleId: storedCustomRoleId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
          },
        });

        const finalAdminCount = await tx.roleBinding.count({
          where: {
            organizationId: team.organizationId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
            role: TeamUserRole.ADMIN,
            userId: { not: null },
          },
        });

        if (finalAdminCount === 0) {
          throw new TeamLastAdminRequiredError(team.name);
        }
      });
    } else {
      await this.prisma.$transaction(async (tx) => {
        const team = await tx.team.findUnique({
          where: { id: teamId },
          select: { organizationId: true, name: true },
        });
        if (!team) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Team not found",
          });
        }

        const orgMembership = await tx.organizationUser.findUnique({
          where: {
            userId_organizationId: {
              userId,
              organizationId: team.organizationId,
            },
          },
        });

        if (orgMembership?.role === OrganizationUserRole.EXTERNAL) {
          if (
            !isTeamRoleAllowedForOrganizationRole({
              organizationRole: OrganizationUserRole.EXTERNAL,
              teamRole: role as TeamRoleValue,
            })
          ) {
            throw new LiteMemberViewerOnlyError(team.name);
          }
        }

        const adminCount = await tx.roleBinding.count({
          where: {
            organizationId: team.organizationId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
            role: TeamUserRole.ADMIN,
            userId: { not: null },
          },
        });

        if (adminCount === 0) {
          throw new TeamLastAdminRequiredError(team.name);
        }

        const targetUserBinding = await tx.roleBinding.findFirst({
          where: {
            organizationId: team.organizationId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
            userId,
          },
          select: { role: true },
        });

        if (!targetUserBinding) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User is not a member of this team",
          });
        }

        const isTargetUserAdmin = targetUserBinding.role === TeamUserRole.ADMIN;
        const wouldDemoteAdmin =
          isTargetUserAdmin && role !== TeamUserRole.ADMIN;

        if (adminCount === 1 && wouldDemoteAdmin) {
          if (userId === currentUserId) {
            throw new CannotRemoveSelfAsLastAdminError(team.name);
          }

          throw new TeamLastAdminRequiredError(team.name);
        }

        await tx.roleBinding.deleteMany({
          where: {
            organizationId: team.organizationId,
            userId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
          },
        });
        await tx.roleBinding.create({
          data: {
            id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
            organizationId: team.organizationId,
            userId,
            role: role as TeamUserRole,
            customRoleId: null,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
          },
        });

        const finalAdminCount = await tx.roleBinding.count({
          where: {
            organizationId: team.organizationId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
            role: TeamUserRole.ADMIN,
            userId: { not: null },
          },
        });

        if (finalAdminCount === 0) {
          throw new TeamLastAdminRequiredError(team.name);
        }
      });
    }
  }

  async getAuditLogs(
    filters: AuditLogFilters,
  ): Promise<{ auditLogs: EnrichedAuditLog[]; totalCount: number }> {
    const {
      organizationId,
      projectId,
      userId,
      pageOffset,
      pageSize,
      action,
      startDate,
      endDate,
    } = filters;

    const orgUserIds = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      select: { userId: true },
    });
    const orgUserIdsList = orgUserIds.map((ou) => ou.userId);

    const orgIdConditions: Prisma.AuditLogWhereInput[] = [{ organizationId }];

    if (orgUserIdsList.length > 0) {
      orgIdConditions.push({
        organizationId: null,
        userId: { in: orgUserIdsList },
        projectId: { not: null },
      });
    }

    const where: Prisma.AuditLogWhereInput = {};
    const andConditions: Prisma.AuditLogWhereInput[] = [
      { OR: orgIdConditions },
    ];

    if (userId) {
      andConditions.push({ userId });
    }

    if (action) {
      andConditions.push({
        action: {
          contains: action,
          mode: "insensitive" as const,
        },
      });
    }

    if (projectId) {
      andConditions.push({
        OR: [{ projectId }, { projectId: null }],
      });
    }

    if (startDate !== undefined || endDate !== undefined) {
      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (startDate !== undefined) {
        dateFilter.gte = new Date(startDate);
      }
      if (endDate !== undefined) {
        dateFilter.lte = new Date(endDate);
      }
      andConditions.push({ createdAt: dateFilter });
    }

    // Gateway-resource deep-link filter (`/settings/audit-log?targetKind=…
    // &targetId=…`). Both columns live on `AuditLog` post-consolidation —
    // see migration 20260425000000_consolidate_gateway_audit_into_audit_log.
    // targetId is only honored when paired with targetKind so a stray
    // `?targetId=` from a typo'd URL cannot match across kinds.
    if (filters.targetKind) {
      andConditions.push({ targetKind: filters.targetKind });
      if (filters.targetId) {
        andConditions.push({ targetId: filters.targetId });
      }
    }

    if (andConditions.length > 1) {
      where.AND = andConditions;
    } else {
      Object.assign(where, andConditions[0]);
    }

    const [totalCount, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip: pageOffset,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // userId is nullable post-consolidation (system-actor writes) — filter
    // null out before passing to the Prisma `IN` predicate, which rejects
    // null array members at runtime.
    const userIds = [
      ...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id)),
    ];
    const projectIds = [
      ...new Set(
        rows.map((r) => r.projectId).filter((id): id is string => !!id),
      ),
    ];

    const [users, projects] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true },
      }),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    const auditLogs: EnrichedAuditLog[] = rows.map((log) => {
      // Gateway-shape rows are emitted under the `gateway.<resource>.<verb>`
      // dotted naming convention; the `gateway.` prefix is the load-bearing
      // discriminator (also documented for SIEM scoping via LIKE 'gateway.%').
      // Presence of targetKind alone is not a safe signal — platform features
      // could in principle add their own target tracking later.
      const isGateway = log.action.startsWith("gateway.");
      return {
        id: log.id,
        createdAt: log.createdAt,
        userId: log.userId,
        organizationId: log.organizationId,
        projectId: log.projectId,
        action: log.action,
        payload: isGateway ? (log.after ?? log.before ?? null) : log.args,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        error: log.error,
        args: isGateway ? { before: log.before, after: log.after } : log.args,
        user: log.userId ? (userMap.get(log.userId) ?? null) : null,
        project: log.projectId ? (projectMap.get(log.projectId) ?? null) : null,
        source: isGateway ? "gateway" : "platform",
        targetKind: log.targetKind,
        targetId: log.targetId,
        before: log.before,
        after: log.after,
      };
    });

    return { auditLogs, totalCount };
  }
}
