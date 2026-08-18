/**
 * ADR-092 delivery-plan PR 3 (D-PR3-10) — share links, written through the
 * grants ledger for a cut-over organization. The same per-organization fork
 * the collector runs (see `authz/repositories/authz-read.cutover.repository.ts`
 * and the `AuthzCutoverProjection` table both of them read): resolve the
 * organization this call is about, ask the cutover gate, and either speak the
 * ledger or delegate to the Prisma repository untouched.
 *
 * Only WRITES fork. Every read delegates, always, because the compat
 * `ShareLink` head is complete by construction: the cutover migration adopted
 * every legacy row's id as its grant id, and the fold keeps writing that same
 * row for every fact minted since. A cut-over organization's links therefore
 * resolve through exactly the query they always did, on exactly the row they
 * always did — what changed is who authors it.
 *
 * The one column the fold never touches is `viewCount` (decision 22): view
 * consumption has a different writer, a different rate and no business being
 * replayed, so its authority for a cut-over organization is the `GrantUsage`
 * row, and the compat column is a mirror this repository maintains so an
 * organization rolled back to legacy keeps counting from where it got to.
 */
import { nanoid } from "nanoid";
import type { PrismaClient, ShareLink } from "~/generated/prisma/client";
import { cutoverOnEngine } from "../../authz/cutover-gate";
import type {
  GrantsLedgerWriter,
  LedgerActor,
  LedgerResourcePrincipal,
} from "../../authz/ledger";
import type {
  CreateShareLinkParams,
  ShareRepository,
  ShareResourceType,
  ShareWithProject,
} from "./share.repository";

/** The single permission a share link has ever conferred (ADR-057). */
const SHARE_LINK_PERMISSION = "traces:view";

/**
 * Nothing in the port carries who is acting — `ShareService` revokes on
 * behalf of a request whose actor stopped at the router — so the ledger
 * hears the truth: the platform revoked it. The customer-visible authorship
 * of a link stays on the fact itself (`createdByUserId`).
 */
const SYSTEM_ACTOR: LedgerActor = { type: "system", id: null };

/** Prisma's unique-constraint failure, read off the code so it survives a
 *  client instance boundary. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export class LedgerShareRepository implements ShareRepository {
  private readonly legacy: ShareRepository;
  private readonly prisma: PrismaClient;
  private readonly writer: () => GrantsLedgerWriter;

  constructor(deps: {
    legacy: ShareRepository;
    prisma: PrismaClient;
    /** Composed per call, like every other ledger caller: the writer holds
     *  no state and the pipeline it sends through resolves at send time. */
    writer: () => GrantsLedgerWriter;
  }) {
    this.legacy = deps.legacy;
    this.prisma = deps.prisma;
    this.writer = deps.writer;
  }

  async findByToken(token: string): Promise<ShareWithProject | null> {
    return this.legacy.findByToken(token);
  }

  async findById(params: {
    id: string;
    projectId: string;
  }): Promise<ShareWithProject | null> {
    return this.legacy.findById(params);
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

  /**
   * Mint a link as a fact. The id is minted HERE rather than by the row's
   * `@default(nanoid())`, because it has to be known before the write: it is
   * the grant id, and the compat row the fold writes carries it. Same
   * generator, same shape, same column — a customer cannot tell which side
   * of the cutover their link was minted on.
   */
  async create(params: CreateShareLinkParams): Promise<ShareLink> {
    const organizationId = await this.ledgerOrganizationFor(params.projectId);
    if (!organizationId) return this.legacy.create(params);

    const id = nanoid();
    const visibility = params.visibility ?? "PUBLIC";
    await this.writer().attachResourceGrant({
      organizationId,
      grantId: id,
      projectId: params.projectId,
      principal: audienceFor({
        visibility,
        organizationId,
        projectId: params.projectId,
      }),
      scopeId: params.resourceId,
      resource: {
        token: params.token,
        permission: SHARE_LINK_PERMISSION,
        kind: params.resourceType === "THREAD" ? "thread" : "trace",
        ...(params.expiresAt
          ? { expiresAtMs: params.expiresAt.getTime() }
          : {}),
        ...(params.maxViews != null ? { maxViews: params.maxViews } : {}),
        ...(params.userId ? { createdByUserId: params.userId } : {}),
      },
      actor: params.userId
        ? { type: "user", id: params.userId }
        : { type: "system", id: null },
    });

    const row = await this.legacy.findById({
      id,
      projectId: params.projectId,
    });
    if (!row) {
      // The append landed and the mint is durable — what has not happened is
      // the fold, so there is no row to return and no action the caller can
      // take about that (ADR-045: a plain Error, an unknown-error surface and
      // a trace id, not a HandledError promising a remedy nobody has).
      throw new Error(
        `share link ${id} was recorded on the grants ledger but its compat row has not landed; the projection queue is stalled`,
      );
    }
    return row;
  }

  /**
   * Revoke one link. Revocation enforcement deletes the `Grant` row and the
   * compat `ShareLink` row together (decision 7), so the token stops
   * resolving before this returns.
   */
  async deleteById({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<void> {
    const organizationId = await this.ledgerOrganizationFor(projectId);
    if (!organizationId) return this.legacy.deleteById({ id, projectId });

    const grantIds = await this.resourceGrantIds({
      organizationId,
      projectId,
      id,
    });
    if (grantIds.length === 0) {
      // The cutover import adopted every share link the organization had, so
      // a live link with no grant behind it can only be one minted while the
      // organization was rolled back onto legacy. It is a plain row; delete
      // it the plain way.
      return this.legacy.deleteById({ id, projectId });
    }
    await this.writer().revokeResourceGrants({
      organizationId,
      grantIds,
      actor: SYSTEM_ACTOR,
    });
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
    const organizationId = await this.ledgerOrganizationFor(projectId);
    if (!organizationId) {
      return this.legacy.deleteByResource({
        projectId,
        resourceType,
        resourceId,
      });
    }
    await this.revokeThenSweep({
      organizationId,
      projectId,
      resourceKind: resourceType,
      resourceId,
      sweep: () =>
        this.legacy.deleteByResource({ projectId, resourceType, resourceId }),
    });
  }

  async deleteAllTraceShares(projectId: string): Promise<void> {
    const organizationId = await this.ledgerOrganizationFor(projectId);
    if (!organizationId) return this.legacy.deleteAllTraceShares(projectId);

    await this.revokeThenSweep({
      organizationId,
      projectId,
      resourceKind: "TRACE",
      sweep: () => this.legacy.deleteAllTraceShares(projectId),
    });
  }

  /**
   * Consume one view. The authoritative count for a cut-over organization is
   * `GrantUsage` — a row with one writer (this repository) that the fold
   * never rebuilds — and the compat column is mirrored from it, in that
   * order, so a rolled-back organization's liveness reads stay right.
   */
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
      // Rollback-window mint again: no fact, so no usage row to be the
      // authority, and the compat column counts for itself.
      return this.legacy.consumeView({ id, projectId, maxViews });
    }

    const consumed = await this.consumeUsage({
      grantId: id,
      organizationId,
      projectId,
      maxViews,
    });
    if (consumed) {
      // The mirror IS the legacy repository's own conditional consume, run
      // for its write rather than its answer: same statement, same cap
      // condition, one place where the shape lives. `ShareLink.viewCount`
      // stays ShareService-owned accounting on the compat row — the fold
      // writes every other column of it and never this one (decision 22).
      await this.legacy.consumeView({ id, projectId, maxViews });
    }
    return consumed;
  }

  /**
   * The atomic conditional consume, on the usage row. Three states are
   * indistinguishable from a zero-row update — no row yet, the cap reached,
   * and a concurrent first view — so the create is attempted and the unique
   * violation is what tells them apart, with one retry of the condition for
   * the racer that lost.
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
    const increment = async (): Promise<boolean> => {
      const result = await this.prisma.grantUsage.updateMany({
        where: {
          grantId,
          organizationId,
          ...(capped ? { viewCount: { lt: maxViews } } : {}),
        },
        data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
      });
      return result.count > 0;
    };

    if (await increment()) return true;
    // A cap of zero (or less) admits nobody, so the first view must not be
    // able to sneak in through the create below.
    if (capped && maxViews <= 0) return false;

    try {
      await this.prisma.grantUsage.create({
        data: {
          grantId,
          organizationId,
          projectId,
          viewCount: 1,
          lastViewedAt: new Date(),
        },
      });
      return true;
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      // Another viewer created the row between the update and the create.
      // The row exists now, so the cap is the only thing left that can
      // refuse: re-run the condition exactly once.
      return increment();
    }
  }

  /**
   * Revoke what the ledger knows about, then let the legacy delete sweep
   * whatever `ShareLink` rows are left. Both stores have to be named,
   * because a link minted while the organization was rolled back has a
   * compat row and no fact — revoking would miss it, and deleting the whole
   * set first would leave its fact behind for the fold to re-project. So:
   * the intersection through the ledger (which removes both heads), then the
   * remainder the plain way.
   */
  private async revokeThenSweep({
    organizationId,
    projectId,
    resourceKind,
    resourceId,
    sweep,
  }: {
    organizationId: string;
    projectId: string;
    resourceKind: ShareResourceType;
    resourceId?: string;
    sweep: () => Promise<void>;
  }): Promise<void> {
    const grantIds = await this.resourceGrantIds({
      organizationId,
      projectId,
      resourceKind,
      ...(resourceId !== undefined ? { resourceId } : {}),
    });
    if (grantIds.length > 0) {
      await this.writer().revokeResourceGrants({
        organizationId,
        grantIds,
        actor: SYSTEM_ACTOR,
      });
    }
    await sweep();
  }

  /** The RESOURCE grants this organization holds for a project, narrowed by
   *  whatever the caller can name: one id, or a kind and a resource. */
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
        // organizationId on every grant read (the org guard's requirement,
        // and the tenancy the lineage read already established).
        organizationId,
        projectId,
        scopeType: "RESOURCE",
        ...(id !== undefined ? { id } : {}),
        ...(resourceKind !== undefined ? { resourceKind } : {}),
        ...(resourceId !== undefined ? { scopeId: resourceId } : {}),
      },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * The organization this project belongs to, or null when the write should
   * go to legacy — either because the lineage is unresolvable or because the
   * organization has not been cut over. One indexed read plus the gate's
   * cached answer, per write call.
   */
  private async ledgerOrganizationFor(
    projectId: string,
  ): Promise<string | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    const organizationId = project?.team?.organizationId;
    if (!organizationId) return null;
    const onEngine = await cutoverOnEngine({
      prisma: this.prisma,
      organizationId,
    });
    return onEngine ? organizationId : null;
  }
}

/** ADR-057's visibility, as the audience the fact names. */
function audienceFor({
  visibility,
  organizationId,
  projectId,
}: {
  visibility: NonNullable<CreateShareLinkParams["visibility"]>;
  organizationId: string;
  projectId: string;
}): LedgerResourcePrincipal {
  switch (visibility) {
    case "PUBLIC":
      return { type: "anyone", id: null };
    case "ORGANIZATION":
      return { type: "organization", id: organizationId };
    case "PROJECT":
      return { type: "project", id: projectId };
    default: {
      // A visibility added to the stored enum without an audience here would
      // otherwise mint a link nobody can match.
      const unreachable: never = visibility;
      throw new Error(
        `unhandled share link visibility: ${String(unreachable)}`,
      );
    }
  }
}
