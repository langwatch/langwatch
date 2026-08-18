// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

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

import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import {
  Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import {
  type GrantsLedgerWriter,
  grantsLedgerWriter,
} from "~/server/app-layer/authz/ledger";
import { SYSTEM_ACTORS } from "~/server/app-layer/authz/ledger-actor";
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
  private readonly writer: GrantsLedgerWriter;

  constructor(
    private readonly prisma: PrismaClient,
    deps: { writer?: GrantsLedgerWriter } = {},
  ) {
    this.writer = deps.writer ?? grantsLedgerWriter();
  }

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
    try {
      return await this.tryCreate({
        userId,
        organizationId,
        displayName,
        displayEmail,
      });
    } catch (err) {
      // Concurrent ensure() race — partial unique idx
      // `Team_organizationId_ownerUserId_personal_key` rejects the
      // second create. Re-fetch the winner's row instead of bubbling
      // a 500 to the caller (e.g. two near-simultaneous CLI logins
      // for a brand-new user, or session resolver + invite-accept
      // racing on first login).
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const winner = await this.findExisting({ userId, organizationId });
        if (winner) {
          // The race loser cannot know how far the winner got: the team
          // commit and the grant append are separate writes, so this return
          // path repairs the owner's grant exactly as the in-transaction
          // found-existing path does.
          await this.repairOwnerGrantIfMissing({
            userId,
            organizationId,
            teamId: winner.team.id,
          });
          return { ...winner, created: false };
        }
      }
      throw err;
    }
  }

  private async tryCreate({
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
    // The team, the project and the legacy TeamUser row are not grant facts
    // and keep their transaction; the owner's ADMIN grant on the workspace is
    // a ledger command (ADR-092 §13), so the team it points at is collected
    // here and the grant is emitted once the team exists.
    let grantOnTeamId: string | null = null;

    const workspace = await this.prisma.$transaction(async (tx) => {
      const existing = await this.findInTx(tx, { userId, organizationId });
      if (existing) {
        // The workspace row existing says nothing about the grant that makes
        // it usable: the team and the grant are not one transaction, so an
        // earlier ensure() can have committed the team and died before the
        // append, leaving an owner with a workspace they cannot administer
        // and no path back except this repair. Re-assert only when it is
        // actually missing, since this runs on the session path.
        const grantHeld = await this.ownerGrantExists(tx, {
          userId,
          organizationId,
          teamId: existing.team.id,
        });
        if (!grantHeld) {
          grantOnTeamId = existing.team.id;
        }
        return { ...existing, created: false };
      }

      const reactivated = await this.reactivateInTx(tx, {
        userId,
        organizationId,
        onGrantNeeded: (teamId) => {
          grantOnTeamId = teamId;
        },
      });
      if (reactivated) {
        return { ...reactivated, created: false };
      }

      const created = await this.createInTx(tx, {
        userId,
        organizationId,
        displayName,
        displayEmail,
      });
      // ADMIN grant so the user can manage their own personal team. Nobody
      // else is ever granted this scope — personal teams are single-member by
      // definition — and it is emitted after this transaction commits.
      grantOnTeamId = created.team.id;
      return created;
    });

    if (grantOnTeamId) {
      await this.attachOwnerAdminGrant({
        userId,
        organizationId,
        teamId: grantOnTeamId,
      });
    }

    return workspace;
  }

  /** The team + project + legacy TeamUser writes of a brand-new workspace. */
  private async createInTx(
    tx: TxClient,
    {
      userId,
      organizationId,
      displayName,
      displayEmail,
    }: {
      userId: string;
      organizationId: string;
      displayName?: string | null;
      displayEmail?: string | null;
    },
  ): Promise<PersonalWorkspace> {
    // Use the user's display name if available, otherwise their local
    // email part (jane@acme.com → "jane"), otherwise a fallback. Slug
    // gets a nanoid suffix to avoid global slug collisions across orgs.
    const displayLabel =
      displayName?.trim() || displayEmail?.split("@")[0] || "user";

    const team = await tx.team.create({
      data: {
        id: generate(KSUID_RESOURCES.TEAM).toString(),
        name: `${displayLabel}'s Workspace`,
        slug: `personal-${userId.toLowerCase().slice(0, 12)}-${nanoid(6).toLowerCase()}`,
        organizationId,
        isPersonal: true,
        ownerUserId: userId,
      },
    });

    const project = await tx.project.create({
      data: {
        id: generate(KSUID_RESOURCES.PROJECT).toString(),
        name: "Personal Workspace",
        slug: `personal-${userId.toLowerCase().slice(0, 12)}-${nanoid(6).toLowerCase()}`,
        // API key kept distinct from VK secret format. Personal projects
        // get a key like every other project for trace ingestion paths
        // that still authenticate via project apiKey.
        apiKey: `pkey_${nanoid(40)}`,
        teamId: team.id,
        language: "other",
        framework: "other",
        isPersonal: true,
        ownerUserId: userId,
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
  }

  /** Whether the owner already holds a binding on their personal team. */
  private async ownerGrantExists(
    client: TxClient | PrismaClient,
    {
      userId,
      organizationId,
      teamId,
    }: { userId: string; organizationId: string; teamId: string },
  ): Promise<boolean> {
    const grant = await client.roleBinding.findFirst({
      where: {
        organizationId,
        userId,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
      },
      select: { id: true },
    });
    return grant !== null;
  }

  /**
   * The owner's ADMIN grant on their personal team — a ledger command
   * (ADR-092 §13), duplicate-safe: re-asserting a grant the owner already
   * holds emits nothing.
   */
  private async attachOwnerAdminGrant({
    userId,
    organizationId,
    teamId,
  }: {
    userId: string;
    organizationId: string;
    teamId: string;
  }): Promise<void> {
    await this.writer.attachBindings({
      organizationId,
      bindings: [
        {
          bindingId: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          principal: { userId },
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamId,
        },
      ],
      // Nobody decided this: the workspace is the product's own, and its
      // owner administers it by construction.
      actor: { type: "system", id: SYSTEM_ACTORS.personalWorkspace },
      onDuplicate: "skip",
    });
  }

  /**
   * Re-asserts the owner's ADMIN grant when the projection shows none — the
   * repair for a workspace whose earlier ensure() died between the team
   * commit and the grant append. Duplicate-safe, so racing repairs converge.
   */
  private async repairOwnerGrantIfMissing({
    userId,
    organizationId,
    teamId,
  }: {
    userId: string;
    organizationId: string;
    teamId: string;
  }): Promise<void> {
    const grantHeld = await this.ownerGrantExists(this.prisma, {
      userId,
      organizationId,
      teamId,
    });
    if (grantHeld) return;
    await this.attachOwnerAdminGrant({ userId, organizationId, teamId });
  }

  /**
   * Brings back the workspace a removed membership archived, if there is one.
   *
   * The slot is one personal team per (organization, owner) and the partial
   * unique index enforcing it covers archived rows, while every lookup filters
   * `archivedAt: null`. So an archived workspace is invisible and yet still holds
   * the slot: creating a replacement raises P2002 and there is no way back.
   * Reactivating is the only correct answer, and it is also the kinder one,
   * because the person gets their own history back rather than an empty room.
   *
   * Runs inside `tryCreate`'s transaction, between the live lookup and the
   * create, so the ordering is: use it, revive it, or make it.
   *
   * The owner's ADMIN binding is recreated rather than assumed: removing the
   * membership deleted every role binding they had in the organization, this one
   * included, so a revived workspace without it would be one they cannot open.
   */
  private async reactivateInTx(
    tx: TxClient,
    {
      userId,
      organizationId,
      onGrantNeeded,
    }: {
      userId: string;
      organizationId: string;
      onGrantNeeded: (teamId: string) => void;
    },
  ): Promise<Omit<PersonalWorkspace, "created"> | null> {
    const archived = await tx.team.findFirst({
      where: {
        organizationId,
        ownerUserId: userId,
        isPersonal: true,
        archivedAt: { not: null },
      },
      select: {
        id: true,
        projects: {
          where: { isPersonal: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    // A team without its project is the broken shape `ensure()` cannot resolve,
    // and reviving half of it would only hide that. Leave it to raise P2002 on
    // the create below, which is loud and recoverable by hand, rather than hand
    // back a workspace with nowhere to put anything.
    if (!archived || archived.projects.length === 0) return null;

    await tx.team.update({
      where: { id: archived.id },
      data: { archivedAt: null },
    });
    await tx.project.updateMany({
      where: { teamId: archived.id, isPersonal: true },
      data: { archivedAt: null },
    });

    // The grant is re-asserted rather than checked for: the attach that
    // follows the transaction skips a grant the owner already holds, so a
    // workspace revived twice emits the fact once.
    onGrantNeeded(archived.id);

    return await this.findInTx(tx, { userId, organizationId });
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
