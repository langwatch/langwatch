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
 * Creates the org / team / project / key an anonymous agent gets, and later
 * attaches a real owner to it.
 *
 * Deliberately not built on `OrganizationService.createAndAssign`: that path
 * is user-centric — it takes a `userId` and writes the membership rows in the
 * same transaction. Reusing it here would mean inventing a placeholder User
 * for every temporary account, which is a row with credentials-shaped columns
 * and no owner, in a table where everything else is a real person. An org with
 * no members until someone claims it is the smaller lie, and it makes the
 * claim a single membership insert rather than an identity merge.
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
    // writes and cannot join one. So a failure here is compensated by hand:
    // the cascade from Organization takes the team and project with it, and
    // an orphaned org would otherwise sit there with no owner to notice it
    // and no deadline to reap it.
    try {
      const key = await this.ingestionKeys.ensureForProject({
        callerUserId: null,
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
      await this.prisma.organization
        .delete({ where: { id: workspace.organizationId } })
        .catch((cleanupError: unknown) => {
          logger.error(
            { organizationId: workspace.organizationId, cleanupError },
            "failed to roll back provisioned workspace",
          );
        });
      throw error;
    }
  }

  private async createWorkspace(params: {
    projectName: string;
  }): Promise<Omit<ProvisionedWorkspace, "ingestionKey">> {
    const orgId = generate(KSUID_RESOURCES.ORGANIZATION).toString();
    const teamId = generate(KSUID_RESOURCES.TEAM).toString();
    const base = slugify(params.projectName, { lower: true, strict: true });

    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          id: orgId,
          name: params.projectName,
          slug: `${base}-${nanoid(8).toLowerCase()}`,
          pricingModel: PricingModel.SEAT_EVENT,
        },
      });

      const team = await tx.team.create({
        data: {
          id: teamId,
          name: params.projectName,
          slug: `${base}-${nanoid(8).toLowerCase()}`,
          organizationId: organization.id,
        },
      });

      const project = await tx.project.create({
        data: {
          id: generate(KSUID_RESOURCES.PROJECT).toString(),
          name: params.projectName,
          slug: `${base}-${nanoid(8).toLowerCase()}`,
          apiKey: `pkey_${nanoid(40)}`,
          teamId: team.id,
          language: "other",
          framework: "other",
        },
      });

      return {
        organizationId: organization.id,
        teamId: team.id,
        projectId: project.id,
        projectSlug: project.slug,
        projectName: project.name,
      };
    });
  }

  /**
   * Make a real user the owner. Writes the same membership + role-binding rows
   * `createAndAssign` writes for a normal signup, so a claimed workspace is
   * indistinguishable from one created the ordinary way.
   *
   * Idempotent: a retry after a partial failure must not throw on the rows it
   * already wrote.
   */
  async attachOwner(params: {
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const teams = await this.prisma.team.findMany({
      where: { organizationId: params.organizationId },
      select: { id: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.organizationUser.upsert({
        where: {
          userId_organizationId: {
            userId: params.userId,
            organizationId: params.organizationId,
          },
        },
        create: {
          userId: params.userId,
          organizationId: params.organizationId,
          role: "ADMIN",
        },
        update: { role: "ADMIN" },
      });

      const scopes = [
        {
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: params.organizationId,
        },
        ...teams.map((team) => ({
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: team.id,
        })),
      ];

      for (const scope of scopes) {
        const existing = await tx.roleBinding.findFirst({
          where: {
            organizationId: params.organizationId,
            userId: params.userId,
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
            userId: params.userId,
            role: TeamUserRole.ADMIN,
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
          },
        });
      }
    });
  }
}
