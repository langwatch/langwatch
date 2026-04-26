/**
 * PersonalWorkspaceService — owns the lifecycle of a user's "Personal
 * Workspace" inside an organization.
 *
 * Personal Workspace shape (Vercel-pattern, Option B from gateway.md):
 *   - Personal Team:    Team.isPersonal=true, Team.ownerUserId=user.id
 *                       (one per (org, user), enforced by partial unique idx)
 *   - Personal Project: Project.isPersonal=true, Project.ownerUserId=user.id
 *                       (one per personal team — that's the workspace)
 *   - RoleBinding:      ADMIN of the personal team for the owning user
 *
 * The personal project is where personal VirtualKeys live, where personal
 * traces accumulate, and what the user lands on when they switch to "My
 * Workspace" in the UI. It uses the same multi-tenancy invariant as every
 * other project (TenantId = projectId in ClickHouse), so no special
 * casing in the trace pipeline.
 *
 * The service is idempotent: callable on every login + invite-accept
 * without side-effects after the first run. Callers can either call
 * `ensure()` directly (creates if missing) or use `findExisting()` for
 * read-only paths that should not allocate.
 */
import {
  Prisma,
  PIIRedactionLevel,
  type PrismaClient,
  ProjectSensitiveDataVisibilityLevel,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { KSUID_RESOURCES } from "~/utils/constants";

type TxClient = Prisma.TransactionClient;

export interface PersonalWorkspace {
  team: {
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
  };
  project: {
    id: string;
    name: string;
    slug: string;
    apiKey: string;
    createdAt: Date;
  };
  /** True iff the workspace was created in this call. */
  created: boolean;
}

export class PersonalWorkspaceService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Idempotently create (or return) the personal workspace for the
   * (user, organization) pair. Safe to call on every login.
   *
   * Wraps everything in a single transaction so partial failures don't
   * leave a personal team without its project, or vice-versa.
   *
   * `displayName` and `displayEmail` are used to seed the team name only
   * on first creation; subsequent calls leave the existing team name
   * alone (the user may have renamed it via UI).
   */
  async ensure({
    userId,
    organizationId,
    displayName,
    displayEmail,
  }: {
    userId: string;
    organizationId: string;
    displayName?: string | null;
    displayEmail?: string | null;
  }): Promise<PersonalWorkspace> {
    return await this.prisma.$transaction(async (tx) => {
      const existing = await this.findInTx(tx, { userId, organizationId });
      if (existing) {
        return { ...existing, created: false };
      }

      // Use the user's display name if available, otherwise their local
      // email part (jane@miro.com → "jane"), otherwise a fallback. Slug
      // gets a nanoid suffix to avoid global slug collisions across orgs.
      const displayLabel =
        displayName?.trim() ||
        displayEmail?.split("@")[0] ||
        "user";
      const teamName = `${displayLabel}'s Workspace`;
      const teamSlug = `personal-${userId.toLowerCase().slice(0, 12)}-${nanoid(6).toLowerCase()}`;
      const projectSlug = `personal-${userId.toLowerCase().slice(0, 12)}-${nanoid(6).toLowerCase()}`;

      const team = await tx.team.create({
        data: {
          id: generate(KSUID_RESOURCES.TEAM).toString(),
          name: teamName,
          slug: teamSlug,
          organizationId,
          isPersonal: true,
          ownerUserId: userId,
        },
      });

      const project = await tx.project.create({
        data: {
          id: generate(KSUID_RESOURCES.PROJECT).toString(),
          name: "Personal Workspace",
          slug: projectSlug,
          // API key kept distinct from VK secret format. Personal projects
          // get a key like every other project for trace ingestion paths
          // that still authenticate via project apiKey.
          apiKey: `pkey_${nanoid(40)}`,
          teamId: team.id,
          language: "other",
          framework: "other",
          isPersonal: true,
          ownerUserId: userId,
          piiRedactionLevel: PIIRedactionLevel.ESSENTIAL,
          capturedInputVisibility:
            ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
          capturedOutputVisibility:
            ProjectSensitiveDataVisibilityLevel.VISIBLE_TO_ALL,
        },
      });

      // ADMIN role binding so the user can manage their own personal team.
      // No team-level RoleBinding for anyone else — personal teams are
      // single-member by definition.
      await tx.roleBinding.create({
        data: {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId,
          userId,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: team.id,
        },
      });

      // Legacy TeamUser row too — many existing read paths still join via
      // TeamUser. Keeps the personal team visible to any code that pre-
      // dates the RoleBinding refactor.
      await tx.teamUser.create({
        data: {
          userId,
          teamId: team.id,
          role: TeamUserRole.ADMIN,
        },
      });

      return {
        team: {
          id: team.id,
          name: team.name,
          slug: team.slug,
          createdAt: team.createdAt,
        },
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          apiKey: project.apiKey,
          createdAt: project.createdAt,
        },
        created: true,
      };
    });
  }

  /**
   * Read-only lookup. Returns null if no personal workspace exists yet.
   * Use this from hot paths (auth/session resolution) where allocation
   * would be wrong — `ensure()` is for the first-login + invite-accept
   * write paths.
   */
  async findExisting({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<Omit<PersonalWorkspace, "created"> | null> {
    return await this.findInTx(this.prisma, { userId, organizationId });
  }

  private async findInTx(
    client: TxClient | PrismaClient,
    {
      userId,
      organizationId,
    }: {
      userId: string;
      organizationId: string;
    },
  ): Promise<Omit<PersonalWorkspace, "created"> | null> {
    const team = await client.team.findFirst({
      where: {
        organizationId,
        ownerUserId: userId,
        isPersonal: true,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        projects: {
          where: { isPersonal: true, archivedAt: null },
          select: {
            id: true,
            name: true,
            slug: true,
            apiKey: true,
            createdAt: true,
          },
          take: 1,
        },
      },
    });

    if (!team || team.projects.length === 0) {
      return null;
    }
    const project = team.projects[0]!;

    return {
      team: {
        id: team.id,
        name: team.name,
        slug: team.slug,
        createdAt: team.createdAt,
      },
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        apiKey: project.apiKey,
        createdAt: project.createdAt,
      },
    };
  }
}
