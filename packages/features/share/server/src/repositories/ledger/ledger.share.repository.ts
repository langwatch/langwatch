/**
 * Cut-over organisations write links through the grants ledger while all
 * reads use the compatible ShareLink head. GrantUsage owns view counts; the
 * ShareLink count is its rollback-safe mirror (ADR-092, decision 22).
 */
import type { LedgerActor } from "@langwatch/actor";
import {
  AUTHZ_SHARE_PERMISSION,
  type AuthzGrantsService,
  type AuthzService,
  authzShareAudience,
} from "@langwatch/authz-contract";
import { nanoid } from "nanoid";
import type { ShareLink } from "@langwatch/share-contract";
import type { ShareDatabase, ShareTransactionDatabase } from "../../ports/share-database.port";
import {
  ShareRepository,
  type CreateShareLinkParams,
  type ShareResourceType,
  type ShareWithProject,
} from "../share.repository";

/** Revocations are system actions; link authorship remains on the mint fact. */
const SYSTEM_ACTOR: LedgerActor = { type: "system", id: null };

function idFromRow(row: unknown): string {
  if (typeof row !== "object" || row === null || !("id" in row) || typeof row.id !== "string") {
    throw new Error("Share id query returned an invalid row");
  }

  return row.id;
}

function organizationIdFromProject(row: unknown): string | null {
  if (typeof row !== "object" || row === null || !("team" in row)) {
    return null;
  }

  const team = row.team;
  if (
    typeof team !== "object" ||
    team === null ||
    !("organizationId" in team) ||
    typeof team.organizationId !== "string"
  ) {
    return null;
  }

  return team.organizationId;
}

/** Prisma's unique-constraint failure, read off the code so it survives a
 *  client instance boundary. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/** Prisma's record-not-found failure (P2025) — what a conditioned `update`
 *  raises when its filter matches no row, read off the code for the same
 *  reason as above. */
function isRecordNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
}

export class LedgerShareRepository extends ShareRepository {
  private readonly legacy: ShareRepository;
  private readonly prisma: ShareDatabase;
  private readonly grants: AuthzGrantsService;
  private readonly authz: AuthzService;

  static create(deps: {
    legacy: ShareRepository;
    prisma: ShareDatabase;
    grants: AuthzGrantsService;
    authz: AuthzService;
  }): LedgerShareRepository {
    return new LedgerShareRepository(deps);
  }

  private constructor(deps: {
    legacy: ShareRepository;
    prisma: ShareDatabase;
    grants: AuthzGrantsService;
    authz: AuthzService;
  }) {
    super();
    this.legacy = deps.legacy;
    this.prisma = deps.prisma;
    this.grants = deps.grants;
    this.authz = deps.authz;
  }

  async tryFindByToken(token: string): Promise<ShareWithProject | null> {
    return this.legacy.tryFindByToken(token);
  }

  async tryFindById(params: { id: string; projectId: string }): Promise<ShareWithProject | null> {
    return this.legacy.tryFindById(params);
  }

  async listByResource(params: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<ShareLink[]> {
    return this.legacy.listByResource(params);
  }

  async hasActiveShareForResource(params: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<boolean> {
    return this.legacy.hasActiveShareForResource(params);
  }

  async findAllTraceShareResourceIds(projectId: string): Promise<string[]> {
    return this.legacy.findAllTraceShareResourceIds(projectId);
  }

  /** Mint the shared id before the fact so the grant and compat row agree. */
  async create(params: CreateShareLinkParams): Promise<ShareLink> {
    const organizationId = await this.ledgerOrganizationFor(params.projectId);
    if (!organizationId) return this.legacy.create(params);

    const id = nanoid();
    const visibility = params.visibility ?? "PUBLIC";
    await this.grants.attachResourceGrant({
      organizationId,
      grantId: id,
      projectId: params.projectId,
      principal: authzShareAudience({
        visibility,
        organizationId,
        projectId: params.projectId,
      }),
      scopeId: params.resourceId,
      resource: {
        token: params.token,
        permission: AUTHZ_SHARE_PERMISSION,
        kind: params.resourceType === "THREAD" ? "thread" : "trace",
        ...(params.expiresAt ? { expiresAtMs: params.expiresAt.getTime() } : {}),
        ...(params.maxViews != null ? { maxViews: params.maxViews } : {}),
        ...(params.userId ? { createdByUserId: params.userId } : {}),
      },
      actor: params.userId ? { type: "user", id: params.userId } : { type: "system", id: null },
    });

    const row = await this.legacy.tryFindById({
      id,
      projectId: params.projectId,
    });
    if (!row) {
      // The fact is durable but its compatible read row has not landed.
      throw new Error(
        `share link ${id} was recorded on the grants ledger but its compat row has not landed; the projection queue is stalled`,
      );
    }
    return row;
  }

  /**
   * Revoke by the shared grant/link id. This remains correct while the fold is
   * between its compatible row and Grant-head writes, and prevents revival.
   */
  async deleteById({ id, projectId }: { id: string; projectId: string }): Promise<void> {
    const organizationId = await this.revocationOrganizationFor(projectId);
    if (!organizationId) return this.legacy.deleteById({ id, projectId });

    if (!(await this.linkNamedAt({ organizationId, projectId, id }))) {
      // An unanchored id must not become an organisation-wide revocation.
      return;
    }
    await this.grants.revokeResourceGrants({
      organizationId,
      grantIds: [id],
      actor: SYSTEM_ACTOR,
    });
    // Delete the compatible row synchronously so revocation is immediate.
    await this.legacy.deleteById({ id, projectId });
  }

  /** Check both heads before appending a project-scoped revocation. */
  private async linkNamedAt({
    organizationId,
    projectId,
    id,
  }: {
    organizationId: string;
    projectId: string;
    id: string;
  }): Promise<boolean> {
    const row = await this.prisma.shareLink.findFirst({
      where: { id, projectId },
      select: { id: true },
    });
    if (row) return true;
    const grantIds = await this.resourceGrantIds({
      organizationId,
      projectId,
      id,
    });
    return grantIds.length > 0;
  }

  async deleteByResource({
    projectId,
    resourceType,
    resourceId,
  }: {
    projectId: string;
    resourceType: ShareResourceType;
    resourceId: string;
  }): Promise<void> {
    const organizationId = await this.revocationOrganizationFor(projectId);
    if (!organizationId) {
      return this.legacy.deleteByResource({
        projectId,
        resourceType,
        resourceId,
      });
    }
    await this.revokeKnownLinks({
      organizationId,
      projectId,
      resourceKind: resourceType,
      resourceId,
    });
    await this.legacy.deleteByResource({
      projectId,
      resourceType,
      resourceId,
    });
  }

  async deleteAllTraceShares(projectId: string): Promise<void> {
    const organizationId = await this.revocationOrganizationFor(projectId);
    if (!organizationId) return this.legacy.deleteAllTraceShares(projectId);

    await this.revokeKnownLinks({
      organizationId,
      projectId,
      resourceKind: "TRACE",
    });
    await this.legacy.deleteAllTraceShares(projectId);
  }

  /** Consume GrantUsage and mirror it for a safe rollback to ShareLink. */
  async consumeView({
    id,
    projectId,
    maxViews,
  }: {
    id: string;
    projectId: string;
    maxViews: number | null;
  }): Promise<boolean> {
    const organizationId = await this.ledgerOrganizationFor(projectId);
    if (!organizationId) {
      return this.legacy.consumeView({ id, projectId, maxViews });
    }
    const grantIds = await this.resourceGrantIds({
      organizationId,
      projectId,
      id,
    });
    if (grantIds.length === 0) {
      // A rollback-window mint has no GrantUsage authority.
      return this.legacy.consumeView({ id, projectId, maxViews });
    }

    return this.consumeUsage({
      grantId: id,
      organizationId,
      projectId,
      maxViews,
    });
  }

  /**
   * Atomically consume and mirror a view. A unique failure distinguishes a
   * concurrent first view and retries the cap once in a fresh transaction.
   */
  private async consumeUsage({
    grantId,
    organizationId,
    projectId,
    maxViews,
  }: {
    grantId: string;
    organizationId: string;
    projectId: string;
    maxViews: number | null;
  }): Promise<boolean> {
    const capped = maxViews != null;
    // `update`, unlike Prisma 7 `updateMany`, keeps the cap on the SQL UPDATE.
    const increment = async (db: ShareTransactionDatabase): Promise<boolean> => {
      try {
        await db.grantUsage.update({
          where: {
            grantId,
            organizationId,
            projectId,
            ...(capped ? { viewCount: { lt: maxViews } } : {}),
          },
          data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
        });
        return true;
      } catch (error) {
        if (isRecordNotFound(error)) return false;
        throw error;
      }
    };
    // Mirror in the same transaction; the projection never writes viewCount.
    const mirror = async (db: ShareTransactionDatabase): Promise<void> => {
      try {
        await db.shareLink.update({
          where: {
            id: grantId,
            projectId,
            ...(capped ? { viewCount: { lt: maxViews } } : {}),
          },
          data: { viewCount: { increment: 1 } },
        });
      } catch (error) {
        // A missing or exhausted mirror is not a failed authoritative consume.
        if (!isRecordNotFound(error)) throw error;
      }
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (await increment(tx)) {
          await mirror(tx);
          return true;
        }
        // A non-positive cap must not enter through the first-view create.
        if (capped && maxViews <= 0) return false;
        await tx.grantUsage.create({
          data: {
            grantId,
            organizationId,
            projectId,
            viewCount: 1,
            lastViewedAt: new Date(),
          },
        });
        await mirror(tx);
        return true;
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      // The conflicting transaction created the row; retry the cap once.
      return this.prisma.$transaction(async (tx) => {
        if (!(await increment(tx))) return false;
        await mirror(tx);
        return true;
      });
    }
  }

  /** Revoke ids visible in either head before the compatible-row sweep. */
  private async revokeKnownLinks({
    organizationId,
    projectId,
    resourceKind,
    resourceId,
  }: {
    organizationId: string;
    projectId: string;
    resourceKind: ShareResourceType;
    resourceId?: string;
  }): Promise<void> {
    // A fold may expose the compatible row before its Grant head.
    const [compatRows, grantIds] = await Promise.all([
      this.prisma.shareLink.findMany({
        where: {
          projectId,
          resourceType: resourceKind,
          ...(resourceId !== void 0 ? { resourceId } : {}),
        },
        select: { id: true },
      }),
      this.resourceGrantIds({
        organizationId,
        projectId,
        resourceKind,
        ...(resourceId !== void 0 ? { resourceId } : {}),
      }),
    ]);
    const ids = [...new Set([...compatRows.map(idFromRow), ...grantIds])];
    if (ids.length > 0) {
      await this.grants.revokeResourceGrants({
        organizationId,
        grantIds: ids,
        actor: SYSTEM_ACTOR,
      });
    }
  }

  /** Find project-scoped resource grants using every supplied discriminator. */
  private async resourceGrantIds({
    organizationId,
    projectId,
    id,
    resourceKind,
    resourceId,
  }: {
    organizationId: string;
    projectId: string;
    id?: string;
    resourceKind?: ShareResourceType;
    resourceId?: string;
  }): Promise<string[]> {
    const rows = await this.prisma.grant.findMany({
      where: {
        // Every grant read carries its organisation tenancy fence.
        organizationId,
        revokedAt: null,
        projectId,
        scopeType: "RESOURCE",
        ...(id !== void 0 ? { id } : {}),
        ...(resourceKind !== void 0 ? { resourceKind } : {}),
        ...(resourceId !== void 0 ? { scopeId: resourceId } : {}),
      },
      select: { id: true },
    });
    return rows.map(idFromRow);
  }

  /** Resolve the organisation and use legacy unless AuthZ reports cut-over. */
  private async ledgerOrganizationFor(projectId: string): Promise<string | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    const organizationId = organizationIdFromProject(project);
    if (!organizationId) return null;
    const onEngine = await this.authz.isOnEngine({ organizationId });
    return onEngine ? organizationId : null;
  }

  /**
   * Revocations deliberately bypass the cached cut-over gate: a stale legacy
   * route could leave the Grant head live and let projection revive the link.
   */
  private async revocationOrganizationFor(projectId: string): Promise<string | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    const organizationId = organizationIdFromProject(project);
    if (!organizationId) return null;
    return organizationId;
  }
}
