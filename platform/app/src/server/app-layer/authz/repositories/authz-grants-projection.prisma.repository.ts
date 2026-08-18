import {
  type CompatBindingRowShape,
  type CompatShareLinkRowShape,
  type GrantEventSource,
  type GrantRowShape,
  type GrantsLedgerState,
  grantFactToCompatBinding,
  grantFactToCompatShareLink,
  grantFactToRow,
  grantRowToFact,
  type LedgerMigrationStatus,
  type RoleRowShape,
  roleFactToRow,
  roleRowToFact,
} from "@langwatch/authz-server";
import { createLogger } from "@langwatch/observability";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import type { AuthzGrantsFoldState } from "~/server/event-sourcing/pipelines/authz-grants/projections/authzGrantsState.foldProjection";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";

const logger = createLogger("langwatch:authz:grants-projection");

const UPSERT_CHUNK = 25;

const MIGRATION_STATUSES: readonly LedgerMigrationStatus[] = [
  "migrated",
  "finalized",
  "parked",
  "rolled_back",
];

function parseMigrationStatus(raw: string): LedgerMigrationStatus | null {
  return MIGRATION_STATUSES.find((candidate) => candidate === raw) ?? null;
}

async function inChunks<T>(
  items: T[],
  run: (item: T) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < items.length; i += UPSERT_CHUNK) {
    await Promise.all(items.slice(i, i + UPSERT_CHUNK).map(run));
  }
}

/**
 * The two Prisma failures a projection write can hit against tables the
 * LEGACY paths also write: a unique-constraint collision (P2002) and a
 * foreign-key violation (P2003). Neither is retryable — the row that
 * conflicts is not ours and will still conflict next time — and a throw here
 * escapes before `writeCursor`, so the organization's projection queue
 * re-runs the same batch forever and never advances. Warning and continuing
 * costs one compat row; throwing costs the whole organization's lane.
 */
function isPrismaConflict(error: unknown, codes: string[]): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    codes.includes(error.code)
  );
}

/** The Grant columns the fold owns, without identity. */
type GrantColumns = Omit<GrantRowShape, "id" | "organizationId">;
/** The Role columns the fold owns, without identity. */
type RoleColumns = Omit<
  RoleRowShape,
  "id" | "organizationId" | "permissions"
> & {
  permissions: unknown;
};

/**
 * Every column the fold owns on a `Grant` row, resource tier included. The
 * resource identity columns are in here for the same reason the role ones
 * are: a share link whose kind, project or author changed is a CHANGED fact,
 * and a fingerprint blind to those columns would leave both the future head
 * and its compat `ShareLink` row describing the previous link forever.
 */
function grantFingerprint(row: GrantColumns): string {
  return JSON.stringify([
    row.principalType,
    row.principalId,
    row.roleKey,
    row.legacyRole,
    row.source,
    row.scopeType,
    row.scopeId,
    row.token,
    row.permission,
    row.resourceKind,
    row.projectId,
    row.createdByUserId,
    row.expiresAt?.getTime() ?? null,
    row.maxViews,
    row.occurredAt.getTime(),
  ]);
}

/**
 * Whether what storage holds already satisfies a folded transition, so the
 * fold must write nothing at all. Two ways it can:
 *   • the stored row is NEWER — a direct write by the runner, which a
 *     lagging fold may never regress;
 *   • it is exactly this transition — and touching it would bump `updatedAt`,
 *     which the ops page reads as "last transitioned".
 */
function migrationRowSatisfies({
  stored,
  status,
  occurredAtMs,
}: {
  stored: { status: string; occurredAt: Date } | undefined;
  status: string;
  occurredAtMs: number;
}): boolean {
  if (!stored) return false;
  const storedMs = stored.occurredAt.getTime();
  if (storedMs > occurredAtMs) return true;
  return stored.status === status && storedMs === occurredAtMs;
}

function roleFingerprint(row: RoleColumns): string {
  return JSON.stringify([
    row.name,
    row.description,
    row.permissions,
    row.kind,
    row.occurredAt.getTime(),
  ]);
}

/** What storage already holds for one organization, read once per `store()`. */
interface StoredHeads {
  /**
   * Whether the cursor row exists. It is the only thing that tells `store()`
   * apart from `load()`'s two outcomes: no cursor means `load()` returned
   * null and the fold started from EMPTY, so the state in hand describes the
   * events of this batch alone and says nothing about what the organization
   * had before. Pruning against it would delete every other grant it owns.
   */
  reconstructed: boolean;
  grants: Map<string, GrantColumns>;
  roles: Map<string, RoleColumns>;
  migrations: Map<string, { status: string; occurredAt: Date }>;
}

/**
 * The grants ledger's two-headed Postgres store (ADR-092 §13, decision 10):
 * one writer, two views. `store()` materialises the folded state into
 * `Grant`/`Role` (the future head) AND legacy-shaped
 * `RoleBinding`/`CustomRole` rows — plus, for the resource tier, `ShareLink`
 * rows (the compat head the legacy resolver and the share reads keep
 * reading), plus the per-org cursor and the cutover projection —
 * every write idempotent by deterministic id, no transactions (decision 7):
 * a crash between writes re-runs under the queue's per-org lock and every
 * upsert converges.
 *
 * `store()` is a DELTA, not a rewrite. It reads what storage already holds
 * and writes only the facts the fold actually changed. Re-upserting every
 * grant on every event was not merely wasteful:
 *   • it resurrected compat rows the legacy write paths had deleted or
 *     edited (they still own those rows for every organization that has not
 *     forked onto the ledger),
 *   • a member removed and re-added at the same role gets a fresh grant id,
 *     and re-upserting the OLD id's compat row then violates
 *     `RoleBinding_user_builtin_role_scope_key` — a P2002 thrown before
 *     `writeCursor`, which parks the organization's lane forever,
 *   • and it bumped every migration-state row on every event, which is both
 *     a lie on the ops page and an ordering hazard.
 *
 * Compat deletions are keyed by the grant ids that LEFT the state, never by
 * a diff of the whole table — so a legacy-authored `RoleBinding` or
 * `ShareLink` row can never be collateral: its id is not a grant id.
 *
 * Write ORDER is load-bearing twice over:
 *   • roles are upserted before the grant compat rows that reference them,
 *     and role deletions happen after grant deletions, so no step can raise
 *     a foreign-key violation on `RoleBinding.customRoleId`;
 *   • per fact, the COMPAT row is written before its `Grant`/`Role` head and
 *     deleted after it, which makes the head row the fact's commit marker:
 *     a crash mid-write leaves the head disagreeing with the state, and the
 *     re-run (the cursor never advanced) redoes both.
 */
export class PrismaAuthzGrantsProjectionRepository
  implements StateProjectionStore<AuthzGrantsFoldState>
{
  constructor(private readonly prisma: PrismaClient) {}

  async load(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjection<AuthzGrantsFoldState> | null> {
    const organizationId = key;
    const cursor = await this.prisma.authzProjectionCursor.findUnique({
      where: { organizationId },
    });
    if (!cursor) return null;

    const [grantRows, roleRows, cutover, migrationRows] = await Promise.all([
      this.prisma.grant.findMany({ where: { organizationId } }),
      this.prisma.role.findMany({ where: { organizationId } }),
      this.prisma.authzCutoverProjection.findUnique({
        where: { organizationId },
      }),
      this.prisma.systemMigrationTenantState.findMany({
        where: { tenantId: organizationId },
      }),
    ]);

    const state: AuthzGrantsFoldState = {
      // The base class's bookkeeping stamps are not persisted as columns —
      // they re-derive from the cursor envelope, which the executor keeps.
      CreatedAt: cursor.createdAt.getTime(),
      UpdatedAt: cursor.updatedAt.getTime(),
      LastEventOccurredAt: cursor.occurredAt.getTime(),
      organizationId,
      grants: Object.fromEntries(
        grantRows.map((row) => {
          const fact = grantRowToFact(row);
          return [fact.grantId, fact];
        }),
      ),
      roles: Object.fromEntries(
        roleRows.map((row) => {
          const fact = roleRowToFact({
            ...row,
            permissions: row.permissions as string[],
          });
          return [fact.roleId, fact];
        }),
      ),
      cutover: {
        onEngine: cutover?.onEngine ?? false,
        provedAtMs: cutover?.provedAt?.getTime() ?? null,
        parityDiffs: (cutover?.parityDiffs as string[] | null) ?? [],
        completionRefusedReason: cutover?.completionRefusedReason ?? null,
        changedAtMs: cutover?.changedAt?.getTime() ?? null,
      },
      migrationStates: Object.fromEntries(
        migrationRows.flatMap((row) => {
          const status = parseMigrationStatus(row.status);
          if (!status) return [];
          return [
            [
              row.migrationName,
              {
                status,
                ...(row.report === null ? {} : { report: row.report }),
                // Business time, not `updatedAt`: the row's wall clock moves
                // for reasons that are not transitions.
                occurredAtMs: row.occurredAt.getTime(),
              },
            ] as const,
          ];
        }),
      ),
    };

    return {
      state,
      cursor: {
        acceptedAt: cursor.acceptedAt.getTime(),
        eventId: cursor.lastEventId,
      },
      occurredAt: cursor.occurredAt.getTime(),
      createdAt: cursor.createdAt.getTime(),
      updatedAt: cursor.updatedAt.getTime(),
      version: cursor.projectionVersion,
    };
  }

  /**
   * The instant-enforcement revocation write (decision 7; ADR-007
   * amendment): the ONE sanctioned direct projection write. A revocation's
   * caller deletes the affected grant heads synchronously after its event
   * has appended, so the deny holds before the call returns even with the
   * queue stopped. The fold later applies the same revocation in order;
   * deleting an absent row is a no-op, so enforcement and convergence
   * coexist. Shaped so it can only make deny true early, never grant.
   * Production caller arrives with PR 2's revoke/offboard write paths.
   */
  async enforceGrantRevocation({
    organizationId,
    grantIds,
  }: {
    organizationId: string;
    grantIds: string[];
  }): Promise<void> {
    if (grantIds.length === 0) return;
    // ShareLink's tenancy column is projectId, not organizationId, and the
    // multitenancy guard requires it on every bulk write. The Grant rows are
    // where that projectId lives, so it is read BEFORE they are deleted. No
    // rows back means the fold already applied this revocation - and it
    // deleted the share rows in the same pass, so there is nothing left to
    // enforce early.
    const revoked = await this.prisma.grant.findMany({
      where: { organizationId, id: { in: grantIds } },
      select: { projectId: true },
    });
    const projectIds = [
      ...new Set(
        revoked.flatMap((row) => (row.projectId ? [row.projectId] : [])),
      ),
    ];

    await this.prisma.grant.deleteMany({
      where: { organizationId, id: { in: grantIds } },
    });
    // Compat rows share the grant id, so this can only ever remove rows the
    // ledger itself authored - never a legacy-authored binding.
    await this.prisma.roleBinding.deleteMany({
      where: { organizationId, id: { in: grantIds } },
    });
    if (projectIds.length > 0) {
      // Same id-sharing argument for the resource tier: an imported share
      // link ADOPTS its own id as the grant id, so a row named here is one
      // the ledger authored or adopted.
      await this.prisma.shareLink.deleteMany({
        where: { projectId: { in: projectIds }, id: { in: grantIds } },
      });
    }
  }

  /**
   * The cutover rollback's instant-enforcement write — the same revocation
   * class as above (decision 7), applied to the flip itself. An operator
   * rolling an organization back sends `cutover_rolled_back` and then calls
   * this, so the projection the request-path gate reads says "legacy"
   * before the operator's call returns, with the queue stopped or not. The
   * fold applies the identical event later and converges on the same row.
   *
   * Shaped so it can only ever move the organization back onto the legacy
   * path: `onEngine` is written false and nothing else. The upsert's create
   * half is for an organization whose projection row does not exist yet —
   * that is already "off", and writing the row makes the answer explicit
   * rather than inferred.
   *
   * What bounds the fleet: the cutover gate's 60s TTL. Pods holding a
   * positive answer stop honouring it within that window, which is the
   * spec's "within the gate's cache window" and the reason the positive
   * bound is short.
   */
  async enforceCutoverRollback({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<void> {
    await this.prisma.authzCutoverProjection.upsert({
      where: { organizationId },
      create: { organizationId, onEngine: false },
      update: { onEngine: false },
    });
  }

  async store(
    projection: StoredProjection<AuthzGrantsFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const organizationId = context.aggregateId;
    const { state } = projection;
    const heads = await this.readStoredHeads(organizationId);

    await this.upsertRoleHeads({ organizationId, state, heads });
    await this.removeDepartedGrants({ organizationId, state, heads });
    await this.upsertGrantHeads({ organizationId, state, heads });
    await this.removeDepartedRoles({ organizationId, state, heads });
    await this.writeCutover({ organizationId, state });
    await this.writeMigrationStates({ organizationId, state, heads });
    await this.writeCursor({ organizationId, projection });
  }

  /**
   * One read of everything `store()` diffs against, taken under the queue's
   * per-org lock. Deliberately re-read rather than remembered from `load()`:
   * the repository is a long-lived singleton shared by every organization,
   * and per-instance memory keyed by org would either leak an entry per
   * tenant or answer a `store()` whose `load()` it never saw.
   */
  private async readStoredHeads(organizationId: string): Promise<StoredHeads> {
    const [cursor, grantRows, roleRows, migrationRows] = await Promise.all([
      this.prisma.authzProjectionCursor.findUnique({
        where: { organizationId },
        select: { organizationId: true },
      }),
      this.prisma.grant.findMany({ where: { organizationId } }),
      this.prisma.role.findMany({ where: { organizationId } }),
      this.prisma.systemMigrationTenantState.findMany({
        where: { tenantId: organizationId },
      }),
    ]);
    return {
      reconstructed: cursor !== null,
      grants: new Map(grantRows.map((row) => [row.id, row])),
      roles: new Map(roleRows.map((row) => [row.id, row])),
      migrations: new Map(
        migrationRows.map((row) => [
          row.migrationName,
          { status: row.status, occurredAt: row.occurredAt },
        ]),
      ),
    };
  }

  private async removeDepartedGrants({
    organizationId,
    state,
    heads,
  }: {
    organizationId: string;
    state: GrantsLedgerState;
    heads: StoredHeads;
  }): Promise<void> {
    // A fold that started from empty state (no cursor row) knows only this
    // batch's events. Everything else the organization owns would read as
    // "departed" and be deleted — both heads, in one pass.
    if (!heads.reconstructed) return;
    const departed = [...heads.grants.entries()].filter(
      ([id]) => state.grants[id] === undefined,
    );
    const removedGrantIds = departed.map(([id]) => id);
    if (removedGrantIds.length === 0) return;

    // The resource tier's compat row is a `ShareLink`, whose tenancy column
    // is projectId rather than organizationId — so the delete is scoped by
    // the projectIds the departing rows themselves carried, read from the
    // heads BEFORE the `Grant` rows go. Same id-sharing argument as the
    // bindings: an imported link ADOPTS its own id as the grant id, so a row
    // named here is one the ledger authored or adopted.
    const departedProjectIds = [
      ...new Set(
        departed.flatMap(([, row]) => (row.projectId ? [row.projectId] : [])),
      ),
    ];

    // Compat rows first: the `Grant` row is the fact's commit marker, so a
    // crash between the two leaves the marker in place and the re-run
    // deletes both. Compat rows share the grant id, so this can only ever
    // remove rows the ledger itself authored.
    await this.prisma.roleBinding.deleteMany({
      where: { organizationId, id: { in: removedGrantIds } },
    });
    if (departedProjectIds.length > 0) {
      await this.prisma.shareLink.deleteMany({
        where: {
          projectId: { in: departedProjectIds },
          id: { in: removedGrantIds },
        },
      });
    }
    await this.prisma.grant.deleteMany({
      where: { organizationId, id: { in: removedGrantIds } },
    });
  }

  /**
   * Departed roles leave the future head unconditionally, but their compat
   * `CustomRole` row only when NOTHING still points at it.
   *
   * `RoleBinding.customRoleId` and `TeamUser.assignedRoleId` are SetNull
   * relations, and imported roles keep their legacy `CustomRole` id — so
   * deleting one nulls `customRoleId` on legacy-authored rows whose `role`
   * column stays `CUSTOM`, and `CUSTOM` with no custom role resolves to
   * `viewer`. A projection is not allowed to silently downgrade a legacy
   * row's permissions, so a referenced role keeps its compat row and says so
   * in the log.
   */
  private async removeDepartedRoles({
    organizationId,
    state,
    heads,
  }: {
    organizationId: string;
    state: GrantsLedgerState;
    heads: StoredHeads;
  }): Promise<void> {
    if (!heads.reconstructed) return;
    const removedRoleIds = [...heads.roles.keys()].filter(
      (id) => state.roles[id] === undefined,
    );
    if (removedRoleIds.length === 0) return;

    const referenced = await this.customRoleIdsStillReferenced({
      organizationId,
      roleIds: removedRoleIds,
    });
    const deletable = removedRoleIds.filter((id) => !referenced.has(id));
    if (referenced.size > 0) {
      logger.warn(
        { organizationId, roleIds: [...referenced] },
        "grants projection kept a compat custom role that legacy rows still reference",
      );
    }
    if (deletable.length > 0) {
      await this.prisma.customRole.deleteMany({
        where: { organizationId, id: { in: deletable } },
      });
    }
    await this.prisma.role.deleteMany({
      where: { organizationId, id: { in: removedRoleIds } },
    });
  }

  private async customRoleIdsStillReferenced({
    organizationId,
    roleIds,
  }: {
    organizationId: string;
    roleIds: string[];
  }): Promise<Set<string>> {
    const [bindings, teamUsers] = await Promise.all([
      this.prisma.roleBinding.findMany({
        where: { organizationId, customRoleId: { in: roleIds } },
        select: { customRoleId: true },
        distinct: ["customRoleId"],
      }),
      // TeamUser carries no organization column - the role ids are already
      // this organization's, which is what scopes the query.
      this.prisma.teamUser.findMany({
        where: { assignedRoleId: { in: roleIds } },
        select: { assignedRoleId: true },
        distinct: ["assignedRoleId"],
      }),
    ]);
    const referenced = new Set<string>();
    for (const row of bindings) {
      if (row.customRoleId) referenced.add(row.customRoleId);
    }
    for (const row of teamUsers) {
      if (row.assignedRoleId) referenced.add(row.assignedRoleId);
    }
    return referenced;
  }

  private async upsertGrantHeads({
    organizationId,
    state,
    heads,
  }: {
    organizationId: string;
    state: GrantsLedgerState;
    heads: StoredHeads;
  }): Promise<void> {
    const changed = Object.values(state.grants)
      .map((grant) => ({
        grant,
        row: grantFactToRow({ grant, organizationId }),
      }))
      .filter(({ row }) => {
        const stored = heads.grants.get(row.id);
        return !stored || grantFingerprint(stored) !== grantFingerprint(row);
      });

    await inChunks(changed, async ({ grant, row }) => {
      // Compat first, head second: see the class docblock's commit-marker
      // rule. Each compat mapping returns null for facts its legacy table
      // cannot express - the binding mapping for RESOURCE/PLATFORM scopes,
      // collective principals and lite-member; the share mapping for
      // everything that is not a RESOURCE fact with terms and an audience
      // `ShareVisibility` can name. Those live in the future head only.
      const compat = grantFactToCompatBinding({ grant, organizationId });
      if (compat) {
        await this.writeCompatBinding({
          organizationId,
          row: compat,
          source: grant.source,
        });
      }
      const compatShare = grantFactToCompatShareLink({ grant, organizationId });
      if (compatShare) {
        await this.writeCompatShareLink({
          organizationId,
          row: compatShare,
          source: grant.source,
        });
      }
      const { id, ...rest } = row;
      await this.prisma.grant.upsert({
        where: { organizationId, id },
        create: row,
        update: rest,
      });
    });
  }

  /**
   * The compat head for one grant.
   *
   * Genesis-imported facts are UPDATE-ONLY: the import adopts the ids of
   * rows that already exist, so an update converges them and a missing row
   * means the fact has no legacy row to be — the org-member floor row and
   * the legacy-admin fallback grants (decisions 11 and 20) are inferences
   * the schema never stored. Authoring one here would put a new,
   * legacy-visible `RoleBinding` in front of the resolver, which is exactly
   * what the dark period must not do. Those facts live in the `Grant` head
   * alone; every other source keeps the upsert.
   *
   * A conflict is warned and stepped over, never raised. A legacy-authored
   * row can already occupy this principal's slot under one of RoleBinding's
   * partial unique indexes (the classic case: a member removed and re-added,
   * so the same person holds the same role at the same scope under a
   * different id), and the organization row behind a foreign key can be
   * absent. Neither is retryable, and a throw here escapes before
   * `writeCursor` and parks the organization's whole lane. The `Grant` head
   * is the authority; the compat row is a view.
   */
  private async writeCompatBinding({
    organizationId,
    row,
    source,
  }: {
    organizationId: string;
    row: CompatBindingRowShape;
    source: GrantEventSource;
  }): Promise<void> {
    const { id, ...rest } = row;
    try {
      if (source === "genesis-import") {
        const result = await this.prisma.roleBinding.updateMany({
          where: { organizationId, id },
          data: rest,
        });
        if (result.count === 0) {
          logger.warn(
            { organizationId, grantId: id, source },
            "genesis-import compat binding update matched no legacy row",
          );
        }
        return;
      }
      await this.prisma.roleBinding.upsert({
        where: { organizationId, id },
        create: row,
        update: rest,
      });
    } catch (error) {
      if (!isPrismaConflict(error, ["P2002", "P2003"])) throw error;
      logger.warn(
        { organizationId, grantId: id, source, error },
        "grants projection could not write a compat binding; the future head still holds the grant",
      );
    }
  }

  /**
   * The compat head for one resource grant — the same adoption rule as the
   * bindings above, one tier down.
   *
   * `cutover-import` facts are UPDATE-ONLY: the import adopts the ShareLink
   * row's own id, so the original row IS the compat row and an update
   * converges it. A missing row means there is nothing to converge onto —
   * the import never invents a link nobody minted — so the update matches
   * nothing and that is the whole of the handling. Every other source is a
   * live mint and upserts.
   *
   * `viewCount` appears in neither branch: the create leans on the column's
   * own default (0) and the update never names it, so ShareService's
   * accounting survives every projection pass (decision 22).
   *
   * A conflict is warned and stepped over, never raised — the same rule as
   * the bindings. P2002: the token is unique platform-wide, so a link minted
   * through the legacy path in the same instant occupies the slot this row
   * wants. P2003: the project or the author behind a foreign key is gone.
   * Neither is retryable, and a throw here escapes before `writeCursor` and
   * parks the organization's whole lane. The `Grant` head is the authority;
   * the share row is a view.
   */
  private async writeCompatShareLink({
    organizationId,
    row,
    source,
  }: {
    organizationId: string;
    row: CompatShareLinkRowShape;
    source: GrantEventSource;
  }): Promise<void> {
    const { id, ...rest } = row;
    try {
      if (source === "cutover-import") {
        await this.prisma.shareLink.updateMany({
          where: { projectId: row.projectId, id },
          data: rest,
        });
        return;
      }
      await this.prisma.shareLink.upsert({
        where: { projectId: row.projectId, id },
        create: row,
        update: rest,
      });
    } catch (error) {
      if (!isPrismaConflict(error, ["P2002", "P2003"])) throw error;
      logger.warn(
        { organizationId, grantId: id, source, error },
        "grants projection could not write a compat share link; the future head still holds the grant",
      );
    }
  }

  // Compat head for roles: the same fact under CustomRole's shape. Imported
  // roles keep their CustomRole id, so this upsert writes the row the legacy
  // resolver already reads; ledger-born roles create new ones. Dormant until
  // role events are emitted (PR 2).
  private async upsertRoleHeads({
    organizationId,
    state,
    heads,
  }: {
    organizationId: string;
    state: GrantsLedgerState;
    heads: StoredHeads;
  }): Promise<void> {
    const changed = Object.values(state.roles)
      .map((role) => roleFactToRow({ role, organizationId }))
      .filter((row) => {
        const stored = heads.roles.get(row.id);
        return !stored || roleFingerprint(stored) !== roleFingerprint(row);
      });

    await inChunks(changed, async (row) => {
      const compat = {
        name: row.name,
        description: row.description,
        permissions: row.permissions,
        kind: row.kind,
      };
      try {
        await this.prisma.customRole.upsert({
          where: { organizationId, id: row.id },
          create: { id: row.id, organizationId, ...compat },
          update: compat,
        });
      } catch (error) {
        // P2002: another role in this organization already holds the name
        // (`@@unique([organizationId, name])`) - typically a rename racing a
        // legacy-authored row. P2003: the organization row is not there.
        // Neither is retryable and neither may park the lane.
        if (!isPrismaConflict(error, ["P2002", "P2003"])) throw error;
        logger.warn(
          { organizationId, roleId: row.id, error },
          "grants projection could not write a compat custom role; the future head still holds the role",
        );
      }
      const { id, ...rest } = row;
      await this.prisma.role.upsert({
        where: { organizationId, id },
        create: row,
        update: rest,
      });
    });
  }

  private async writeCutover({
    organizationId,
    state,
  }: {
    organizationId: string;
    state: GrantsLedgerState;
  }): Promise<void> {
    // `changedAt` carries the reducer's monotonic guard back to storage, so
    // a reloaded projection keeps refusing stale cutover facts instead of
    // starting over from "accept anything".
    const row = {
      onEngine: state.cutover.onEngine,
      provedAt:
        state.cutover.provedAtMs != null
          ? new Date(state.cutover.provedAtMs)
          : null,
      parityDiffs: state.cutover.parityDiffs,
      // Why the newest completion fact did not flip this organization. The
      // fold cannot log from inside a pure reducer, so the refusal travels as
      // state and lands here, where an operator can see it.
      completionRefusedReason: state.cutover.completionRefusedReason,
      changedAt:
        state.cutover.changedAtMs != null
          ? new Date(state.cutover.changedAtMs)
          : null,
    };
    await this.prisma.authzCutoverProjection.upsert({
      where: { organizationId },
      create: { organizationId, ...row },
      update: row,
    });
  }

  /**
   * The runner-lifecycle head, monotonically guarded on BUSINESS time: the
   * state table is ALSO written synchronously by the runner (its finalized
   * latch must never wait on a queue), so a lagging fold must never regress
   * a newer direct write. Both writers stamp `occurredAt`, and a folded
   * transition applies only when it is at least as new as the one the row
   * already holds.
   *
   * Guarding on `updatedAt` instead used to invert a replay: the row a
   * replay created carried `updatedAt = now`, so every LATER fact in the
   * same stream failed the guard and `skipDuplicates` dropped it — the
   * table converged to the OLDEST status the stream contained. Business time
   * has no such wall-clock skew, so a replay onto an empty table now
   * converges to the newest, and a replay onto a live one is a no-op.
   *
   * Rows whose (status, occurredAt) already match are not written at all:
   * touching them would bump `updatedAt`, which the ops page reads as "last
   * transitioned".
   */
  private async writeMigrationStates({
    organizationId,
    state,
    heads,
  }: {
    organizationId: string;
    state: GrantsLedgerState;
    heads: StoredHeads;
  }): Promise<void> {
    for (const [migrationName, tenantState] of Object.entries(
      state.migrationStates,
    )) {
      if (
        migrationRowSatisfies({
          stored: heads.migrations.get(migrationName),
          status: tenantState.status,
          occurredAtMs: tenantState.occurredAtMs,
        })
      ) {
        continue;
      }
      const report =
        tenantState.report == null
          ? Prisma.DbNull
          : (tenantState.report as Prisma.InputJsonValue);
      const occurredAt = new Date(tenantState.occurredAtMs);
      const updated = await this.prisma.systemMigrationTenantState.updateMany({
        where: {
          migrationName,
          tenantId: organizationId,
          occurredAt: { lte: occurredAt },
        },
        data: { status: tenantState.status, report, occurredAt },
      });
      if (updated.count === 0) {
        // The row does not exist yet (replay onto an empty table), or a
        // newer direct write landed between the read above and here - create
        // it race-safely and let `skipDuplicates` keep the second case safe.
        await this.prisma.systemMigrationTenantState.createMany({
          data: [
            {
              migrationName,
              tenantId: organizationId,
              status: tenantState.status,
              report,
              occurredAt,
            },
          ],
          skipDuplicates: true,
        });
      }
    }
  }

  // Last write of the cycle: the cursor IS the commit marker. A crash before
  // it re-runs the whole store under the per-org lock; every write above is
  // an idempotent upsert, so the retry converges and the cursor only
  // advances once everything it describes is in place.
  private async writeCursor({
    organizationId,
    projection,
  }: {
    organizationId: string;
    projection: StoredProjection<GrantsLedgerState>;
  }): Promise<void> {
    await this.prisma.authzProjectionCursor.upsert({
      where: { organizationId },
      create: {
        organizationId,
        lastEventId: projection.cursor.eventId,
        acceptedAt: new Date(projection.cursor.acceptedAt),
        occurredAt: new Date(projection.occurredAt),
        projectionVersion: projection.version,
      },
      update: {
        lastEventId: projection.cursor.eventId,
        acceptedAt: new Date(projection.cursor.acceptedAt),
        occurredAt: new Date(projection.occurredAt),
        projectionVersion: projection.version,
      },
    });
  }
}
