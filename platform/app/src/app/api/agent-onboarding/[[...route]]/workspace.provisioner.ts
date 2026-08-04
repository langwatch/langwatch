import { IngestionKeyService } from "@ee/governance/services/ingestionKey.service";
import type {
  ProvisionedWorkspace,
  WorkspaceProvisioner,
} from "@langwatch/ai-onboarding";
import type { AgentSlug } from "@langwatch/contracts/agent-onboarding";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  PricingModel,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { KSUID_RESOURCES } from "~/utils/constants";
import { slugify } from "~/utils/slugify";

const logger = createLogger("langwatch:agent-onboarding:provisioner");

/**
 * Creates the workspace an anonymous agent gets, and settles who owns it once
 * somebody claims.
 *
 * The organization has a real owner from the first millisecond: a placeholder
 * `User` carrying `unclaimedAt`. That is deliberately not an ownerless org —
 * an org with no members breaks things that reasonably assume otherwise
 * (`resolveSupportContact` falls back to "the first admin's email", member
 * lists render nothing, personal-project `ownerUserId` has nowhere to point).
 * A user row that exists but is not a live actor is already an established
 * shape here: `deactivatedAt` means the same thing, and `User.email` is
 * nullable, so the placeholder needs no synthetic address that could collide
 * with a real signup later.
 *
 * What keeps it safe is that `unclaimedAt` is checked in `beforeSessionCreate`,
 * the single choke point for every sign-in path.
 */
export class LangWatchWorkspaceProvisioner implements WorkspaceProvisioner {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ingestionKeys: IngestionKeyService,
  ) {}

  static create(prisma: PrismaClient): LangWatchWorkspaceProvisioner {
    return new LangWatchWorkspaceProvisioner(
      prisma,
      IngestionKeyService.create(prisma),
    );
  }

  async provision(params: {
    projectName: string;
    agent: AgentSlug;
  }): Promise<ProvisionedWorkspace> {
    const workspace = await this.createWorkspace(params);

    // The key mint runs outside the transaction — ApiKeyService owns its own
    // writes and cannot join one — so a failure is compensated by hand. The
    // cascade from User takes the whole workspace with it.
    try {
      const key = await this.ingestionKeys.ensureForProject({
        callerUserId: workspace.userId,
        // A service key, not a personal one: it must keep resolving whatever
        // happens to the placeholder at claim time (promoted, or retired in
        // favour of an existing user).
        ownerUserId: null,
        organizationId: workspace.organizationId,
        projectId: workspace.projectId,
        sourceType: params.agent,
      });

      return {
        ...workspace,
        ingestionKey: { token: key.token, prefix: key.prefix },
      };
    } catch (error) {
      logger.error(
        { organizationId: workspace.organizationId, error },
        "ingestion key mint failed, rolling back provisioned workspace",
      );
      await this.prisma.user
        .delete({ where: { id: workspace.userId } })
        .catch((cleanupError: unknown) => {
          logger.error(
            { userId: workspace.userId, cleanupError },
            "failed to roll back provisioned workspace",
          );
        });
      throw error;
    }
  }

  private async createWorkspace(params: {
    projectName: string;
  }): Promise<Omit<ProvisionedWorkspace, "ingestionKey">> {
    const base = slugify(params.projectName, { lower: true, strict: true });
    const suffix = () => nanoid(8).toLowerCase();

    return this.prisma.$transaction(async (tx) => {
      // No email and no name: nothing to send mail to, nothing to render in a
      // member list, and no unique-email collision with a later real signup.
      const user = await tx.user.create({
        data: { unclaimedAt: new Date() },
      });

      const organization = await tx.organization.create({
        data: {
          id: generate(KSUID_RESOURCES.ORGANIZATION).toString(),
          name: params.projectName,
          slug: `${base}-${suffix()}`,
          pricingModel: PricingModel.SEAT_EVENT,
        },
      });

      // ADMIN so the org has an owner immediately. Seat counting filters
      // unclaimed placeholders, so this membership is never billed.
      await tx.organizationUser.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: "ADMIN",
        },
      });

      const team = await tx.team.create({
        data: {
          id: generate(KSUID_RESOURCES.TEAM).toString(),
          name: params.projectName,
          slug: `${base}-${suffix()}`,
          organizationId: organization.id,
        },
      });

      const project = await tx.project.create({
        data: {
          id: generate(KSUID_RESOURCES.PROJECT).toString(),
          name: params.projectName,
          slug: `${base}-${suffix()}`,
          apiKey: `pkey_${nanoid(40)}`,
          teamId: team.id,
          language: "other",
          framework: "other",
        },
      });

      for (const scope of [
        {
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organization.id,
        },
        { scopeType: RoleBindingScopeType.TEAM, scopeId: team.id },
      ]) {
        await tx.roleBinding.create({
          data: {
            id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
            organizationId: organization.id,
            userId: user.id,
            role: TeamUserRole.ADMIN,
            ...scope,
          },
        });
      }

      return {
        userId: user.id,
        organizationId: organization.id,
        teamId: team.id,
        projectId: project.id,
        projectSlug: project.slug,
        projectName: project.name,
      };
    });
  }

  /**
   * The claimer is the placeholder. Clearing `unclaimedAt` is the entire
   * claim: the memberships and role bindings have been correct since
   * provisioning, so nothing moves and there is no window where the
   * organization has two admins or none.
   */
  async promotePlaceholder(params: {
    placeholderUserId: string;
    email?: string | null;
    name?: string | null;
  }): Promise<void> {
    await this.prisma.user.update({
      where: { id: params.placeholderUserId },
      data: {
        unclaimedAt: null,
        ...(params.email ? { email: params.email } : {}),
        ...(params.name ? { name: params.name } : {}),
      },
    });
  }

  /**
   * The claimer is somebody else. Add them as an admin, then retire the
   * placeholder — leaving it would keep a credential-less admin on an org that
   * now has a real owner.
   *
   * Idempotent: a retry after a partial failure must not throw on rows it
   * already wrote.
   */
  async transferToExistingUser(params: {
    organizationId: string;
    placeholderUserId: string;
    claimingUserId: string;
  }): Promise<void> {
    const teams = await this.prisma.team.findMany({
      where: { organizationId: params.organizationId },
      select: { id: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.organizationUser.upsert({
        where: {
          userId_organizationId: {
            userId: params.claimingUserId,
            organizationId: params.organizationId,
          },
        },
        create: {
          userId: params.claimingUserId,
          organizationId: params.organizationId,
          role: "ADMIN",
        },
        update: { role: "ADMIN" },
      });

      for (const scope of [
        {
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: params.organizationId,
        },
        ...teams.map((team) => ({
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: team.id,
        })),
      ]) {
        const existing = await tx.roleBinding.findFirst({
          where: {
            organizationId: params.organizationId,
            userId: params.claimingUserId,
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
          },
          select: { id: true },
        });
        if (existing) continue;

        await tx.roleBinding.create({
          data: {
            id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
            organizationId: params.organizationId,
            userId: params.claimingUserId,
            role: TeamUserRole.ADMIN,
            ...scope,
          },
        });
      }

      // Retired, not deleted: the ingestion key records it as `createdByUserId`
      // and traces may carry it as provenance, so the row has to survive.
      await tx.user.update({
        where: { id: params.placeholderUserId },
        data: { unclaimedAt: null, deactivatedAt: new Date() },
      });
      await tx.organizationUser.deleteMany({
        where: {
          userId: params.placeholderUserId,
          organizationId: params.organizationId,
        },
      });
      await tx.roleBinding.deleteMany({
        where: {
          userId: params.placeholderUserId,
          organizationId: params.organizationId,
        },
      });
    });
  }
}
