/**
 * ADR-092 delivery-plan PR 3 (D-PR3-10) — share links, written through the
 * grants ledger for a cut-over organization. The same per-organization fork
 * the package-owned AuthZ service runs (see its routed read repository
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
import type { LedgerActor } from "@langwatch/actor";
import {
  AUTHZ_SHARE_PERMISSION,
  type AuthzGrantsService,
  type AuthzService,
  authzShareAudience,
} from "@langwatch/authz-contract";
import { nanoid } from "nanoid";
import type {
  Prisma,
  PrismaClient,
  ShareLink,
} from "~/generated/prisma/client";
import type {
  CreateShareLinkParams,
  ShareRepository,
  ShareResourceType,
  ShareWithProject,
} from "./share.repository";

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

/** Prisma's record-not-found failure (P2025) — what a conditioned `update`
 *  raises when its filter matches no row, read off the code for the same
 *  reason as above. */
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2025"
  );
}

export class LedgerShareRepository implements ShareRepository {
  private readonly legacy: ShareRepository;
  private readonly prisma: PrismaClient;
  private readonly writer: () => AuthzGrantsService;
  private readonly authz: AuthzService;

  constructor(deps: {
    legacy: ShareRepository;
    prisma: PrismaClient;
    /** Composed per call, like every other ledger caller: the writer holds
     *  no state and the pipeline it sends through resolves at send time. */
    writer: () => AuthzGrantsService;
    authz: AuthzService;
  }) {
    this.legacy = deps.legacy;
    this.prisma = deps.prisma;
    this.writer = deps.writer;
    this.authz = deps.authz;
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
   *
   * The revoke is keyed by the link's OWN id, never by a Grant-table read:
   * compat rows share their id with the grant id by construction (the fold
   * authors compat rows with id = grantId; the cutover import adopts
   * ShareLink ids as grant ids), and the fold writes compat-before-head —
   * the Grant row is the commit marker. A ledger-minted link whose fold is
   * parked between the two writes therefore has a compat row and no Grant
   * row yet; discovering grant ids from the Grant table would find nothing,
   * and a legacy-only delete taken on that answer removes the row with no
   * fact appended — for the fold's re-run to put the "revoked" token back,
   * permanently. Keying on the id itself means the `grant_revoked` fact is
   * appended either way, and it sits after the mint in stream order, so the
   * fold can never redo the mint without also folding the revoke.
   */
  async deleteById({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<void> {
    const organizationId = await this.revocationOrganizationFor(projectId);
    if (!organizationId) return this.legacy.deleteById({ id, projectId });

    if (!(await this.linkNamedAt({ organizationId, projectId, id }))) {
      // Neither head anchors this id to the caller's project: the legacy
      // delete would be the same no-op, and an unanchored id must not
      // become an organization-wide revocation fact — the (id, projectId)
      // pair is the tenancy fence every other query here carries.
      return;
    }
    await this.writer().revokeResourceGrants({
      organizationId,
      grantIds: [id],
      actor: SYSTEM_ACTOR,
    });
    // Enforcement locates the compat head THROUGH the Grant row, so when
    // that head has not landed it cannot delete the row the token resolves
    // by. Revocation is instant-enforcement class (decision 7): the compat
    // row goes here, before the call returns, queue running or not. For a
    // link minted during a rollback window this is also the delete that
    // removes it (its revoke fact folds as a no-op).
    await this.legacy.deleteById({ id, projectId });
  }

  /**
   * Whether either head — the compat row or the grant row — names this id
   * in this project: the fence a single-link revoke crosses before it
   * appends. The compat row is checked first because it is the head the
   * fold writes first, so it is the one a parked fold has already landed.
   */
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
    const organizationId = await this.revocationOrganizationFor(projectId);
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

    return this.consumeUsage({
      grantId: id,
      organizationId,
      projectId,
      maxViews,
    });
  }

  /**
   * The atomic conditional consume, on the usage row. Three states are
   * indistinguishable from a zero-row update — no row yet, the cap reached,
   * and a concurrent first view — so the create is attempted and the unique
   * violation is what tells them apart, with one retry of the condition for
   * the racer that lost.
   *
   * Each consuming branch runs inside ONE transaction together with the
   * compat mirror, so the authoritative count and the mirrored one commit
   * or fail as a unit — as two separate writes, a crash between them left
   * the compat column one view behind, which after a rollback onto legacy
   * is a free extra view. The guarded create's EXPECTED unique violation
   * aborts a Postgres transaction, so the single conditioned retry cannot
   * run inside the transaction it just aborted: it opens its own. The
   * branch semantics are exactly the three above; only the commit
   * boundaries moved.
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
    // `update` with the cap in its (filtered-unique) where, NOT `updateMany`:
    // Prisma 7's compiler splits a conditional `updateMany` into a SELECT of
    // matching ids and an UPDATE keyed on those ids ALONE — the cap condition
    // does not ride the UPDATE statement, so concurrent viewers who all
    // passed the SELECT all increment past the cap (read-then-write, not
    // compare-and-swap). `update` keeps its full filter on the UPDATE itself,
    // where Postgres re-evaluates it against the current row after the lock
    // wait — the atomicity the cap depends on — and reports the loser's zero
    // rows as P2025. The project predicate is part of the row's tenancy, not
    // decoration: it is what the resource fact is anchored to, and every
    // other query in this repository already fences on it.
    const increment = async (
      db: Prisma.TransactionClient,
    ): Promise<boolean> => {
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
    // The mirror is the legacy repository's own conditional consume — same
    // statement, same cap condition — issued on THIS transaction's client,
    // because the port cannot lend its statement a foreign transaction and
    // the mirror must commit with the usage write or not at all.
    // `ShareLink.viewCount` stays ShareService-owned accounting on the
    // compat row — the fold writes every other column of it and never this
    // one (decision 22).
    const mirror = async (db: Prisma.TransactionClient): Promise<void> => {
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
        // A compat row already at (or past) the cap, or deleted meanwhile:
        // the mirror matching nothing is the old `updateMany`'s zero-row
        // outcome, not a failure of the consume.
        if (!isRecordNotFound(error)) throw error;
      }
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (await increment(tx)) {
          await mirror(tx);
          return true;
        }
        // A cap of zero (or less) admits nobody, so the first view must not
        // be able to sneak in through the create below.
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
      // Another viewer created the row between the update and the create.
      // The row exists now, so the cap is the only thing left that can
      // refuse: re-run the condition exactly once, in a fresh transaction —
      // the violation aborted the one above before anything committed.
      return this.prisma.$transaction(async (tx) => {
        if (!(await increment(tx))) return false;
        await mirror(tx);
        return true;
      });
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
    // Ids come from BOTH heads. The fold writes compat-before-head, so a
    // ledger-minted link whose Grant row has not landed is visible only
    // through its compat row — skipping it would let the sweep delete the
    // row with no fact behind it, for the fold's re-run to resurrect. A
    // compat-only id that truly has no fact (a rollback-window mint) folds
    // its revoke as a no-op, which is the harmless direction. The one mint
    // neither head can show — appended, with the fold parked before even
    // the compat write — is also one whose id no caller ever received (the
    // mint's read-back throws first), so nothing resolvable escapes it.
    const [compatRows, grantIds] = await Promise.all([
      this.prisma.shareLink.findMany({
        where: {
          projectId,
          resourceType: resourceKind,
          ...(resourceId !== undefined ? { resourceId } : {}),
        },
        select: { id: true },
      }),
      this.resourceGrantIds({
        organizationId,
        projectId,
        resourceKind,
        ...(resourceId !== undefined ? { resourceId } : {}),
      }),
    ]);
    const ids = [...new Set([...compatRows.map((row) => row.id), ...grantIds])];
    if (ids.length > 0) {
      await this.writer().revokeResourceGrants({
        organizationId,
        grantIds: ids,
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
        revokedAt: null,
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
    const onEngine = await this.authz.isOnEngine({ organizationId });
    return onEngine ? organizationId : null;
  }

  /**
   * The organization a REVOCATION is about, or null when the delete belongs
   * to legacy. Deliberately NOT `ledgerOrganizationFor`: revocation is
   * instant-enforcement class (decision 7) and must never come undone, so
   * its routing cannot ride `organizationOnAuthzEngine` — a 60-second-TTL cache
   * that also answers false (and caches it) when the state read throws. Any
   * false window routes a cut-over organization's revoke to the legacy-only
   * branch: the compat row is deleted with no fact appended, the Grant head
   * keeps the grant, and the fold's next run re-projects the "revoked"
   * link. Mints and reads keep the cached gate — a stale answer there costs
   * a legacy-authored row the next genesis pass adopts, never access that
   * was explicitly taken away.
   *
   * So: one UNCACHED state read per revocation, through
   * `readOrganizationOnAuthzEngine`, which raises rather than failing safe
   * because the safe direction here is the opposite one — a FAILED read
   * routes toward the ledger branch, which writes both heads and appends the
   * fact. That direction is harmless when the organization turns out to be
   * on legacy (the sweep still deletes the plain rows, and a fact no mint
   * stands behind changes nothing) and is the only correct one when it is
   * not.
   */
  private async revocationOrganizationFor(
    projectId: string,
  ): Promise<string | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    const organizationId = project?.team?.organizationId;
    if (!organizationId) return null;
    return organizationId;
  }
}
