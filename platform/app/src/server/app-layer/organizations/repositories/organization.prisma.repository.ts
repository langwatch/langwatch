import type { LedgerActor } from "@langwatch/authz-server";
import { NotFoundError, ValidationError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import type { User } from "~/generated/prisma/client";
import {
  type Currency,
  type OrganizationIntent,
  OrganizationUserRole,
  PricingModel,
  Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import {
  type GrantsLedgerWriter,
  grantsLedgerWriter,
  type LedgerBindingAttach,
} from "~/server/app-layer/authz/ledger";
import { ledgerActorFor } from "~/server/app-layer/authz/ledger-actor";
import { findSharedTeamIds } from "~/server/role-bindings/personal-team-scope";
import { projectAdminUserIdsWithoutDirectRole } from "~/server/teams/effective-team-admins";
import { KSUID_RESOURCES } from "~/utils/constants";
import { encrypt } from "~/utils/encryption";
import {
  isTeamRoleAllowedForOrganizationRole,
  ORGANIZATION_TO_TEAM_ROLE_MAP,
  type TeamRoleValue,
} from "~/utils/memberRoleConstraints";
import { GROWTH_SEAT_PLAN_TYPES } from "../../../../../ee/billing/utils/growthSeatEvent";
import { isCustomRole } from "../../../api/enterprise";
import { revokeAllSessionsForUser } from "../../../better-auth/revokeSessions";
import { CustomRoleNotAssignableError } from "../../../role-bindings/errors";
import {
  CannotRemoveSelfAsLastAdminError,
  LiteMemberViewerOnlyError,
  TeamLastAdminRequiredError,
  TeamMembershipNotFoundError,
  TeamNotFoundError,
} from "../../teams/team.service";
import {
  CannotDemoteLastAdminError,
  CannotDisableLastAdminError,
  CannotRemoveLastAdminError,
  MemberNotFoundError,
  OrganizationSlugTakenError,
} from "../errors";
import type {
  AuditLogFilters,
  CreateAndAssignInput,
  CreateAndAssignResult,
  CreateForProvisioningInput,
  DeleteMemberInput,
  EnrichedAuditLog,
  FullyLoadedOrganization,
  MemberTeamBinding,
  OrganizationForBilling,
  OrganizationMemberSummary,
  OrganizationMemberWithUser,
  OrganizationProvisioningSummary,
  OrganizationRepository,
  OrganizationSettings,
  OrganizationWithAdmins,
  OrganizationWithMembersAndTheirTeams,
  SetMemberDisabledInput,
  UpdateMemberRoleInput,
  UpdateMemberRoleResult,
  UpdateOrganizationSettingsInput,
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

/**
 * The organization's active administrators, locked for the rest of the
 * transaction.
 *
 * A plain count is a read-then-write race: two transactions each removing a
 * DIFFERENT admin both count two, both pass their guard, and both commit,
 * leaving an organization nobody can sign in to and no way back from inside
 * the product. `FOR UPDATE` makes the second caller wait for the first to
 * commit and then re-read the set, so it sees the single remaining admin and
 * refuses.
 */
async function lockActiveAdmins({
  tx,
  organizationId,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
}): Promise<Array<{ userId: string }>> {
  // `role::text` rather than a cast to the enum type: the type name would have
  // to be schema-qualified to be safe, and the comparison runs over one
  // organization's memberships either way.
  // `ORDER BY` fixes the order rows are locked in, so two callers racing over
  // the same set queue behind each other instead of deadlocking on a
  // half-acquired one.
  return tx.$queryRaw<Array<{ userId: string }>>`
    SELECT "userId" FROM "OrganizationUser"
    WHERE "organizationId" = ${organizationId}
      AND "role"::text = ${OrganizationUserRole.ADMIN}
      AND "disabledAt" IS NULL
    ORDER BY "userId"
    FOR UPDATE
  `;
}

/** A credential-bearing settings value encrypted at rest; cleared values store null. */
function encryptedOrNull(value: string | null): string | null {
  return value ? encrypt(value) : null;
}

/**
 * The profile fields of a partial settings write: only the fields present on
 * the input are written.
 */
function profileSettingsData(
  input: UpdateOrganizationSettingsInput,
): Prisma.OrganizationUpdateInput {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.supportContact !== undefined
      ? { supportContact: input.supportContact?.trim() || null }
      : {}),
    ...(input.presenceEnabled !== undefined
      ? { presenceEnabled: input.presenceEnabled }
      : {}),
    ...(input.traceSharingEnabled !== undefined
      ? { traceSharingEnabled: input.traceSharingEnabled }
      : {}),
    ...(input.primaryIntent !== undefined
      ? { primaryIntent: input.primaryIntent }
      : {}),
  };
}

/**
 * The stored-objects (S3) fields of a partial settings write: only the fields
 * present on the input are written, and credential-bearing ones are encrypted.
 */
function storageSettingsData(
  input: UpdateOrganizationSettingsInput,
): Prisma.OrganizationUpdateInput {
  return {
    ...(input.s3Endpoint !== undefined
      ? { s3Endpoint: encryptedOrNull(input.s3Endpoint) }
      : {}),
    ...(input.s3AccessKeyId !== undefined
      ? { s3AccessKeyId: encryptedOrNull(input.s3AccessKeyId) }
      : {}),
    ...(input.s3SecretAccessKey !== undefined
      ? { s3SecretAccessKey: encryptedOrNull(input.s3SecretAccessKey) }
      : {}),
    ...(input.s3Bucket !== undefined
      ? { s3Bucket: input.s3Bucket || null }
      : {}),
  };
}

/**
 * The organization row of a provisioning run, with a slug race answered as
 * {@link OrganizationSlugTakenError}.
 *
 * Scoped to this one insert because the surrounding transaction also writes
 * `Team.slug`, `Team.id` and `Organization.id`: a P2002 caught around the
 * whole transaction would tell a provisioning tool to retry a slug that was
 * never the problem. Within this insert, `slug` is the only unique column the
 * caller can collide on twice.
 */
async function createProvisionedOrganization(
  tx: Prisma.TransactionClient,
  input: CreateForProvisioningInput,
) {
  try {
    return await tx.organization.create({
      data: {
        id: input.orgId,
        name: input.orgName,
        slug: input.orgSlug,
        pricingModel: input.pricingModel,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      namesSlug(error.meta?.target)
    ) {
      throw new OrganizationSlugTakenError(input.orgSlug);
    }
    throw error;
  }
}

/**
 * True when a unique-constraint violation names the slug column. Prisma
 * reports the target as either the field list or the constraint name, so both
 * shapes are read.
 */
function namesSlug(target: unknown): boolean {
  if (Array.isArray(target)) {
    return target.some(
      (field) => typeof field === "string" && field === "slug",
    );
  }
  return typeof target === "string" && target.includes("slug");
}

/**
 * Point a member's binding on one scope at a role without replacing the row
 * — an UPDATE, never a delete-then-recreate, which would change its id
 * mid-save: the member dialog stages removals by id, and a binding batch
 * built against ids a churned recreate had already replaced would carry
 * ids that no longer exist. Keeping the id stable keeps what the admin
 * staged addressable through the whole save, and rows keep their creation
 * order instead of jumping to the bottom of the access list on every
 * correction. Several rows on one scope still collapse to the one this
 * sync sets.
 */
async function planUserScopeBinding({
  tx,
  organizationId,
  userId,
  scopeType,
  scopeId,
  role,
  customRoleId,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
  userId: string;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  role: TeamUserRole;
  customRoleId: string | null;
}): Promise<ScopeBindingPlan> {
  const rows = await tx.roleBinding.findMany({
    where: { organizationId, userId, scopeType, scopeId },
    // id breaks createdAt ties so the same row is kept on every execution
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const [keep, ...extras] = rows;
  const revokeIds = extras.map((row) => row.id);
  if (keep) {
    return {
      revokeIds,
      change: { bindingId: keep.id, role, customRoleId },
    };
  }
  return {
    revokeIds,
    attach: {
      bindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      principal: { userId },
      role,
      customRoleId,
      scopeType,
      scopeId,
    },
  };
}

/**
 * What a scope-binding correction resolves to once the transaction has read
 * the rows: the ids that collapse away, and either the role change on the row
 * that stays or a fresh attach. Planned inside the transaction and emitted
 * after it commits — bindings are ledger facts, and the ledger is their only
 * writer (ADR-092 §13).
 */
type ScopeBindingPlan = {
  revokeIds: string[];
  change?: {
    bindingId: string;
    role: TeamUserRole;
    customRoleId: string | null;
  };
  attach?: LedgerBindingAttach;
};

/**
 * Emit a batch of plans, revocations first: a crash mid-batch leaves the
 * member with less access than the correction asked for, never more, and the
 * retry converges. Revoking the collapsed siblings before the role change
 * also keeps the surviving row's target role free of a duplicate.
 */
async function emitScopeBindingPlans({
  writer,
  organizationId,
  plans,
  actor,
}: {
  writer: GrantsLedgerWriter;
  organizationId: string;
  plans: ScopeBindingPlan[];
  actor: LedgerActor;
}): Promise<void> {
  const revokeIds = plans.flatMap((plan) => plan.revokeIds);
  if (revokeIds.length > 0) {
    await writer.revokeBindings({
      organizationId,
      bindingIds: revokeIds,
      actor,
    });
  }
  for (const plan of plans) {
    if (!plan.change) continue;
    await writer.changeBindingRole({
      organizationId,
      bindingId: plan.change.bindingId,
      role: plan.change.role,
      customRoleId: plan.change.customRoleId,
      actor,
    });
  }
  const attaches = plans.flatMap((plan) => (plan.attach ? [plan.attach] : []));
  if (attaches.length > 0) {
    await writer.attachBindings({
      organizationId,
      bindings: attaches,
      actor,
      onDuplicate: "skip",
    });
  }
}

export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly writer: GrantsLedgerWriter = grantsLedgerWriter(),
  ) {}

  getClient(): PrismaClient {
    return this.prisma;
  }

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
    const created = await this.prisma.$transaction(async (tx) => {
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

      return {
        organization: { id: organization.id, name: organization.name },
        team: { id: team.id, slug: team.slug, name: team.name },
      };
    });

    // The organization, its membership row and its first team are not grant
    // facts; the founder's two ADMIN grants are, so they are emitted once the
    // scopes they point at exist.
    await this.writer.attachBindings({
      organizationId: created.organization.id,
      bindings: [
        {
          bindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          principal: { userId: input.userId },
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: created.organization.id,
        },
        {
          bindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          principal: { userId: input.userId },
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: created.team.id,
        },
      ],
      actor: ledgerActorFor({
        userId: input.userId,
        fallback: "organizationService",
      }),
      onDuplicate: "skip",
    });

    return created;
  }

  async createForProvisioning(
    input: CreateForProvisioningInput,
  ): Promise<CreateAndAssignResult> {
    return await this.prisma.$transaction(async (tx) => {
      // Deterministic answer for the common case; the catch inside
      // `createProvisionedOrganization` still covers the race where two
      // provisioning runs claim one slug.
      const taken = await tx.organization.findUnique({
        where: { slug: input.orgSlug },
        select: { id: true },
      });
      if (taken) {
        throw new OrganizationSlugTakenError(input.orgSlug);
      }

      const organization = await createProvisionedOrganization(tx, input);

      const team = await tx.team.create({
        data: {
          id: input.teamId,
          name: input.orgName,
          slug: input.teamSlug,
          organizationId: organization.id,
        },
      });

      return {
        organization: { id: organization.id, name: organization.name },
        team: { id: team.id, slug: team.slug, name: team.name },
      };
    });
  }

  async findAllProvisioningSummaries(): Promise<
    OrganizationProvisioningSummary[]
  > {
    return this.prisma.organization.findMany({
      select: { id: true, name: true, slug: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async deleteProvisionedOrganization(organizationId: string): Promise<void> {
    // Deliberately imperative, and it stays that way: this is a tenant purge,
    // not a grant write. The organization itself is going away, so there is no
    // access left to describe and no stream left to append to — emitting
    // revocations for rows whose aggregate is being deleted would only leave
    // the ledger holding facts about a tenant that no longer exists.
    //
    // Role bindings first: RoleBinding.apiKeyId restricts api-key deletion.
    await this.prisma.$transaction([
      this.prisma.roleBinding.deleteMany({ where: { organizationId } }),
      // The grants ledger's projections (ADR-092 §13). They carry
      // organizationId as a plain column and never a relation - facts derived
      // from the ledger must not presume the row they describe still exists -
      // so nothing cascades them, and a purge that skipped them would leave a
      // deleted tenant's access rows behind as the only surviving head. Usage
      // before its Grant, and the cursor and cutover flag last, so the state
      // this org is served from disappears in one transaction with the rest.
      this.prisma.grantUsage.deleteMany({ where: { organizationId } }),
      this.prisma.grant.deleteMany({ where: { organizationId } }),
      this.prisma.role.deleteMany({ where: { organizationId } }),
      this.prisma.authzProjectionCursor.deleteMany({
        where: { organizationId },
      }),
      this.prisma.authzCutoverProjection.deleteMany({
        where: { organizationId },
      }),
      // The migration machinery's own per-tenant rows follow the same rule:
      // plain organizationId columns, no relation, nothing cascades them. A
      // purge that left them behind would keep a deleted tenant enrolled and
      // its migration state answering the next pass.
      this.prisma.systemMigrationTenantState.deleteMany({
        where: { tenantId: organizationId },
      }),
      this.prisma.systemMigrationEnrollment.deleteMany({
        where: { organizationId },
      }),
      this.prisma.apiKey.deleteMany({ where: { organizationId } }),
      this.prisma.promptTag.deleteMany({ where: { organizationId } }),
      this.prisma.team.deleteMany({ where: { organizationId } }),
      this.prisma.organization.deleteMany({ where: { id: organizationId } }),
    ]);
  }

  async findProvisioningSummaryById(
    organizationId: string,
  ): Promise<OrganizationProvisioningSummary | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true, createdAt: true },
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

  async findMembership(params: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationMemberSummary | null> {
    const { organizationId, userId } = params;
    return this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: {
        userId: true,
        organizationId: true,
        role: true,
        disabledAt: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async findAllMembers(params: {
    organizationId: string;
    includeDisabled: boolean;
    offset: number;
    limit: number;
  }): Promise<{ members: OrganizationMemberSummary[]; totalCount: number }> {
    const { organizationId, includeDisabled, offset, limit } = params;
    const where = {
      organizationId,
      ...(includeDisabled ? {} : { disabledAt: null }),
    };

    const [members, totalCount] = await Promise.all([
      this.prisma.organizationUser.findMany({
        where,
        select: {
          userId: true,
          organizationId: true,
          role: true,
          disabledAt: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: [
          { user: { name: "asc" } },
          { user: { email: "asc" } },
          { userId: "asc" },
        ],
        skip: offset,
        take: limit,
      }),
      this.prisma.organizationUser.count({ where }),
    ]);

    return { members, totalCount };
  }

  async findMemberTeamBindings(params: {
    organizationId: string;
    userId: string;
  }): Promise<MemberTeamBinding[]> {
    const { organizationId, userId } = params;
    const bindings = await this.prisma.roleBinding.findMany({
      where: {
        organizationId,
        userId,
        scopeType: RoleBindingScopeType.TEAM,
      },
      select: {
        scopeId: true,
        role: true,
        customRoleId: true,
        customRole: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    if (bindings.length === 0) return [];

    const teams = await this.prisma.team.findMany({
      where: {
        id: { in: bindings.map((b) => b.scopeId) },
        organizationId,
      },
      select: { id: true, name: true, isPersonal: true },
    });
    const teamsById = new Map(teams.map((team) => [team.id, team]));

    // A binding whose team is missing from the lookup points outside the
    // organization (or at a deleted team) and carries no manageable access;
    // personal workspaces are not managed from these surfaces at all.
    return bindings.flatMap((binding) => {
      const team = teamsById.get(binding.scopeId);
      if (!team || team.isPersonal) return [];
      return [
        {
          teamId: team.id,
          teamName: team.name,
          role: binding.role,
          customRoleId: binding.customRoleId,
          customRoleName: binding.customRole?.name ?? null,
        },
      ];
    });
  }

  async findSettingsById(
    organizationId: string,
  ): Promise<OrganizationSettings | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        supportContact: true,
        presenceEnabled: true,
        traceSharingEnabled: true,
        primaryIntent: true,
        s3Endpoint: true,
        s3AccessKeyId: true,
        s3Bucket: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async updateSettings(input: UpdateOrganizationSettingsInput): Promise<void> {
    await this.prisma.organization.update({
      where: { id: input.organizationId },
      data: {
        ...profileSettingsData(input),
        ...storageSettingsData(input),
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
    const { organizationId, userId, actingUserId } = input;
    const actor = ledgerActorFor({
      userId: actingUserId,
      fallback: "organizationService",
    });
    const revokeTheirGrants = () =>
      this.writer.revokeBindingsWhere({
        organizationId,
        where: { userId },
        actor,
        reason: "organization membership removed",
      });

    const member = await this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true, disabledAt: true },
    });

    if (!member) {
      // The membership is already gone, which is also what a retry of a
      // removal that died between the two writes below sees. Revoking again
      // is a no-op when the first attempt finished and the repair when it did
      // not, so the retry can still reach grants the seat no longer names —
      // refusing outright left them orphaned, and a re-invite reactivated
      // them.
      await revokeTheirGrants();
      throw new MemberNotFoundError(userId);
    }

    await this.assertRemovalKeepsAnActiveAdmin({ organizationId, member });

    // Snapshotted before the revoke below so a refusal inside the
    // transaction — the locked re-check is the one two concurrent removals
    // of the last two admins can actually trip, the advisory check above
    // passes for both — can put back exactly what this call is about to take
    // away, rather than leaving a member who keeps their seat and loses
    // every grant it should carry.
    const grantsBeforeRevoke = await this.prisma.roleBinding.findMany({
      where: { organizationId, userId },
      select: {
        id: true,
        role: true,
        customRoleId: true,
        scopeType: true,
        scopeId: true,
      },
    });

    // Grants go before the membership, not after. A ledger append cannot join
    // the Prisma transaction, so one of the two writes is always exposed to a
    // crash: this order leaves a member who still holds their seat and none of
    // their grants (less access, and the retry converges), where the other
    // order left grants nobody could reach any more.
    await revokeTheirGrants();

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.deleteMembershipRow({ tx, organizationId, userId });
        await this.archivePersonalWorkspaces({ tx, organizationId, userId });
      });
    } catch (error) {
      // The locked re-check inside `deleteMembershipRow` refused this
      // removal — a concurrent removal of the organization's other admin
      // committed first. The grants above are already gone by then, so
      // without this the survivor keeps their seat and holds nothing. Put
      // back exactly the rows just revoked.
      if (grantsBeforeRevoke.length > 0) {
        await this.writer.attachBindings({
          organizationId,
          bindings: grantsBeforeRevoke.map((binding) => ({
            bindingId: binding.id,
            principal: { userId },
            role: binding.role,
            customRoleId: binding.customRoleId,
            scopeType: binding.scopeType,
            scopeId: binding.scopeId,
          })),
          actor,
          onDuplicate: "skip",
        });
      }
      throw error;
    }
  }

  /**
   * Same guard as disabling or demoting the last admin, and the only
   * irreversible one of the three: an organization with no admin who can
   * sign in cannot be recovered from inside the product. Read ahead of the
   * revocation as well as inside the removal transaction, so a refusal never
   * strips the last admin's grants on its way to saying no; the locked read
   * inside the transaction is still the authority.
   */
  private async assertRemovalKeepsAnActiveAdmin({
    organizationId,
    member,
  }: {
    organizationId: string;
    member: { role: OrganizationUserRole; disabledAt: Date | null };
  }): Promise<void> {
    if (
      member.role !== OrganizationUserRole.ADMIN ||
      member.disabledAt !== null
    ) {
      return;
    }
    const activeAdmins = await this.prisma.organizationUser.count({
      where: {
        organizationId,
        role: OrganizationUserRole.ADMIN,
        disabledAt: null,
      },
    });
    if (activeAdmins <= 1) {
      throw new CannotRemoveLastAdminError();
    }
  }

  /**
   * The membership delete itself, re-guarded under the transaction: the
   * pre-transaction reads are advisory, this locked read is the authority.
   */
  private async deleteMembershipRow({
    tx,
    organizationId,
    userId,
  }: {
    tx: Prisma.TransactionClient;
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const stillAMember = await tx.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true, disabledAt: true },
    });

    if (!stillAMember) {
      throw new MemberNotFoundError(userId);
    }

    if (
      stillAMember.role === OrganizationUserRole.ADMIN &&
      stillAMember.disabledAt === null
    ) {
      const activeAdmins = await lockActiveAdmins({ tx, organizationId });

      if (activeAdmins.length <= 1) {
        throw new CannotRemoveLastAdminError();
      }
    }

    await tx.organizationUser.delete({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });
  }

  /**
   * Archives the removed member's personal team and project, on the same
   * terms `PersonalWorkspaceService.ensure()` reactivates them.
   */
  private async archivePersonalWorkspaces({
    tx,
    organizationId,
    userId,
  }: {
    tx: Prisma.TransactionClient;
    organizationId: string;
    userId: string;
  }): Promise<void> {
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
  }

  async setMemberDisabled(input: SetMemberDisabledInput): Promise<void> {
    const { organizationId, userId, disabled } = input;

    await this.prisma.$transaction(async (tx) => {
      const member = await tx.organizationUser.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
        select: { role: true },
      });

      if (!member) {
        throw new MemberNotFoundError(userId);
      }

      // Same guard as demoting the last admin: an organization with no admin
      // who can sign in cannot be recovered from inside the product. Locked
      // for the same reason the removal guard locks: a disable and a removal
      // aimed at the two remaining admins would otherwise both pass.
      if (disabled && member.role === OrganizationUserRole.ADMIN) {
        const activeAdmins = await lockActiveAdmins({ tx, organizationId });

        if (activeAdmins.length <= 1) {
          // Handled rather than a TRPCError: the tRPC boundary maps a 400
          // HandledError to BAD_REQUEST anyway, and the REST surface answers
          // the stable code instead of flattening this refusal to an unknown
          // 500.
          throw new CannotDisableLastAdminError();
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
    // The seat change reads and corrects every scope the seat caps; the
    // corrections are collected here and emitted as commands once the
    // membership transaction has committed.
    const plans: ScopeBindingPlan[] = [];

    // The transaction answers the seat the member held before it, kept so a
    // failed correction can put it back (see the compensation below).
    const previousRole = await this.prisma.$transaction(async (tx) => {
      const currentMember = await tx.organizationUser.findUnique({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
      });

      if (!currentMember) {
        throw new MemberNotFoundError(userId);
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
          // Handled for the same reason as the disable guard: the tRPC
          // boundary still maps the 400 to BAD_REQUEST, and the REST surface
          // answers the stable code instead of an unknown 500.
          throw new CannotDemoteLastAdminError();
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

      // Keep the ORGANIZATION-scoped grant in sync (skip EXTERNAL)
      if (role !== OrganizationUserRole.EXTERNAL) {
        plans.push(
          await planUserScopeBinding({
            tx,
            organizationId,
            userId,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
            role: ORGANIZATION_TO_TEAM_ROLE_MAP[role],
            customRoleId: null,
          }),
        );
      } else {
        // EXTERNAL (Lite Member) users have no org-level grant
        const orgRows = await tx.roleBinding.findMany({
          where: {
            organizationId,
            userId,
            scopeType: RoleBindingScopeType.ORGANIZATION,
            scopeId: organizationId,
          },
          select: { id: true },
        });
        plans.push({ revokeIds: orgRows.map((row) => row.id) });
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
        const wouldDemoteAdmin =
          currentMembership.role === TeamUserRole.ADMIN &&
          nextRole !== TeamUserRole.ADMIN;

        if (wouldDemoteAdmin) {
          const adminsAfter = await projectAdminUserIdsWithoutDirectRole({
            tx,
            organizationId,
            teamId,
            userId,
          });
          if (adminsAfter.size === 0) {
            // A caller who named this team asked for a team-local change, and a
            // team needs an admin. A seat correction did not name it: the
            // decision was about one person's seat, and every shared team is
            // still administered through any ORGANIZATION-scoped ADMIN binding
            // — so it goes through, and the team is reported so the admin who
            // did it is not left to discover this.
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

        plans.push(
          await planUserScopeBinding({
            tx,
            organizationId,
            userId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
            role: nextRole,
            customRoleId: shouldClearCustomRole
              ? null
              : (teamRoleUpdate.customRoleId ?? null),
          }),
        );
      }

      // The seat correction reaches everything the seat caps, and a member
      // can hold PROJECT-scoped rows the team loop above never sees. Shared
      // projects only: the member's own personal workspace keeps its stored
      // rows and is capped at resolution, which is what makes re-promoting
      // them a no-op (personal-workspace-integrity.feature). Corrected
      // through planUserScopeBinding so ids survive, several rows on one
      // project collapse to one, and a pre-existing Viewer row cannot collide
      // with the correction on the partial unique index. Left alone on the
      // way back up: an upgrade grants nothing on its own.
      if (role === OrganizationUserRole.EXTERNAL) {
        const projectRows = await tx.roleBinding.findMany({
          where: {
            organizationId,
            userId,
            scopeType: RoleBindingScopeType.PROJECT,
            OR: [
              { role: { not: TeamUserRole.VIEWER } },
              { customRoleId: { not: null } },
            ],
          },
          select: { scopeId: true },
        });
        if (projectRows.length > 0) {
          const sharedProjects = await tx.project.findMany({
            where: {
              id: { in: projectRows.map((row) => row.scopeId) },
              isPersonal: false,
              team: { organizationId, isPersonal: false },
            },
            select: { id: true },
          });
          for (const project of sharedProjects) {
            plans.push(
              await planUserScopeBinding({
                tx,
                organizationId,
                userId,
                scopeType: RoleBindingScopeType.PROJECT,
                scopeId: project.id,
                role: TeamUserRole.VIEWER,
                customRoleId: null,
              }),
            );
          }
        }
      }

      const finalAdminCount = await tx.organizationUser.count({
        where: {
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
      });

      if (finalAdminCount === 0) {
        throw new CannotDemoteLastAdminError();
      }

      return currentMember.role;
    });

    // The seat has committed and the grants it caps have not. A ledger append
    // cannot join the transaction above, so the correction is compensated
    // instead of shared with it: if it fails the seat goes back to the role it
    // held, and the caller sees the whole change refused with the member's old
    // access standing rather than an ADMIN binding under a MEMBER seat.
    try {
      await emitScopeBindingPlans({
        writer: this.writer,
        organizationId,
        plans,
        actor: ledgerActorFor({
          userId: input.currentUserId,
          fallback: "organizationService",
        }),
      });
    } catch (error) {
      if (previousRole !== role) {
        await this.prisma.organizationUser.updateMany({
          where: { organizationId, userId, role },
          data: { role: previousRole },
        });
      }
      throw error;
    }

    return { teamsLeftWithoutAdmin };
  }

  async updateTeamMemberRole(input: UpdateTeamMemberRoleInput): Promise<void> {
    const { teamId, userId, role, customRoleId, currentUserId } = input;
    const inputIsCustomRole = customRoleId !== undefined;
    let planned: { organizationId: string; plan: ScopeBindingPlan };

    if (inputIsCustomRole && customRoleId) {
      const storedCustomRoleId = customRoleId;

      planned = await this.prisma.$transaction(async (tx) => {
        const team = await tx.team.findUnique({
          where: { id: teamId },
          select: { organizationId: true, name: true },
        });
        if (!team) {
          throw new TeamNotFoundError(teamId);
        }
        const customRole = await tx.customRole.findUnique({
          where: { id: storedCustomRoleId },
          select: { organizationId: true, permissions: true, kind: true },
        });
        if (
          customRole?.kind !== "custom" ||
          customRole.organizationId !== team.organizationId
        ) {
          throw new CustomRoleNotAssignableError(storedCustomRoleId);
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
          throw new TeamMembershipNotFoundError(userId);
        }

        const isTargetUserAdmin = targetUserBinding.role === TeamUserRole.ADMIN;

        // The projection is the whole guard: a save that does not demote an
        // admin cannot shrink the admin set, and one that does is checked
        // against its exact post-state. A team already without an admin stays
        // editable from here — this is one of the places somebody gets
        // promoted back, so the team form's carve-out holds for the member
        // dialog too.
        if (isTargetUserAdmin) {
          const adminsAfter = await projectAdminUserIdsWithoutDirectRole({
            tx,
            organizationId: team.organizationId,
            teamId,
            userId,
          });
          if (adminsAfter.size === 0) {
            if (userId === currentUserId) {
              throw new CannotRemoveSelfAsLastAdminError(team.name);
            }

            throw new TeamLastAdminRequiredError(team.name);
          }
        }

        return {
          organizationId: team.organizationId,
          plan: await planUserScopeBinding({
            tx,
            organizationId: team.organizationId,
            userId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
            role: TeamUserRole.CUSTOM,
            customRoleId: storedCustomRoleId,
          }),
        };
      });
    } else {
      planned = await this.prisma.$transaction(async (tx) => {
        const team = await tx.team.findUnique({
          where: { id: teamId },
          select: { organizationId: true, name: true },
        });
        if (!team) {
          throw new TeamNotFoundError(teamId);
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
          throw new TeamMembershipNotFoundError(userId);
        }

        const isTargetUserAdmin = targetUserBinding.role === TeamUserRole.ADMIN;
        const wouldDemoteAdmin =
          isTargetUserAdmin && role !== TeamUserRole.ADMIN;

        // Same rule as the custom-role branch above: only a save that demotes
        // an admin can shrink the admin set, so the projection is the whole
        // guard and an orphaned team stays editable and repairable.
        if (wouldDemoteAdmin) {
          const adminsAfter = await projectAdminUserIdsWithoutDirectRole({
            tx,
            organizationId: team.organizationId,
            teamId,
            userId,
          });
          if (adminsAfter.size === 0) {
            if (userId === currentUserId) {
              throw new CannotRemoveSelfAsLastAdminError(team.name);
            }

            throw new TeamLastAdminRequiredError(team.name);
          }
        }

        return {
          organizationId: team.organizationId,
          plan: await planUserScopeBinding({
            tx,
            organizationId: team.organizationId,
            userId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
            role: role as TeamUserRole,
            customRoleId: null,
          }),
        };
      });
    }

    await emitScopeBindingPlans({
      writer: this.writer,
      organizationId: planned.organizationId,
      plans: [planned.plan],
      actor: ledgerActorFor({
        userId: currentUserId,
        fallback: "organizationService",
      }),
    });
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
