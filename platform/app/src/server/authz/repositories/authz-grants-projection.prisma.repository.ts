import {
  type GrantsLedgerState,
  grantFactToCompatBinding,
  grantFactToRow,
  grantRowToFact,
  type LedgerMigrationStatus,
  roleFactToRow,
  roleRowToFact,
} from "@langwatch/authz-server";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import type { AuthzGrantsFoldState } from "~/server/event-sourcing/pipelines/authz-grants/projections/authzGrantsState.foldProjection";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";

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
 * The grants ledger's two-headed Postgres store (ADR-092 §13, decision 10):
 * one writer, two views. `store()` materialises the folded state into
 * `Grant`/`Role` (the future head) AND legacy-shaped
 * `RoleBinding`/`CustomRole` rows (the compat head the legacy resolver
 * keeps reading), plus the per-org cursor and the cutover projection —
 * every write idempotent by deterministic id, no transactions (decision 7):
 * a crash between writes re-runs under the queue's per-org lock and every
 * upsert converges.
 *
 * Compat deletions are keyed by the grant ids that LEFT the state, never by
 * a diff of the whole table — so a legacy-authored `RoleBinding` row (the
 * live write paths keep writing them until PR 2) can never be collateral:
 * its id is not a grant id.
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
                occurredAtMs: row.updatedAt.getTime(),
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
    await this.prisma.grant.deleteMany({
      where: { organizationId, id: { in: grantIds } },
    });
    // Compat rows share the grant id, so this can only ever remove rows the
    // ledger itself authored - never a legacy-authored binding.
    await this.prisma.roleBinding.deleteMany({
      where: { organizationId, id: { in: grantIds } },
    });
  }

  async store(
    projection: StoredProjection<AuthzGrantsFoldState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const organizationId = context.aggregateId;
    const { state } = projection;
    await this.removeDepartedFacts({ organizationId, state });
    await this.upsertGrantHeads({ organizationId, state });
    await this.upsertRoleHeads({ organizationId, state });
    await this.writeCutover({ organizationId, state });
    await this.writeMigrationStates({ organizationId, state });
    await this.writeCursor({ organizationId, projection });
  }

  private async removeDepartedFacts({
    organizationId,
    state,
  }: {
    organizationId: string;
    state: GrantsLedgerState;
  }): Promise<void> {
    const [existingGrantIds, existingRoleIds] = await Promise.all([
      this.prisma.grant.findMany({
        where: { organizationId },
        select: { id: true },
      }),
      this.prisma.role.findMany({
        where: { organizationId },
        select: { id: true },
      }),
    ]);
    const removedGrantIds = existingGrantIds
      .map((row) => row.id)
      .filter((id) => state.grants[id] === undefined);
    const removedRoleIds = existingRoleIds
      .map((row) => row.id)
      .filter((id) => state.roles[id] === undefined);

    if (removedGrantIds.length > 0) {
      await this.prisma.grant.deleteMany({
        where: { organizationId, id: { in: removedGrantIds } },
      });
      // Compat rows share the grant id, so this can only ever remove rows
      // the ledger itself authored.
      await this.prisma.roleBinding.deleteMany({
        where: { organizationId, id: { in: removedGrantIds } },
      });
    }
    if (removedRoleIds.length > 0) {
      await this.prisma.role.deleteMany({
        where: { organizationId, id: { in: removedRoleIds } },
      });
      await this.prisma.customRole.deleteMany({
        where: { organizationId, id: { in: removedRoleIds } },
      });
    }
  }

  private async upsertGrantHeads({
    organizationId,
    state,
  }: {
    organizationId: string;
    state: GrantsLedgerState;
  }): Promise<void> {
    const grants = Object.values(state.grants);
    await inChunks(grants, (grant) => {
      const row = grantFactToRow({ grant, organizationId });
      const { id, ...rest } = row;
      return this.prisma.grant.upsert({
        where: { organizationId, id },
        create: row,
        update: rest,
      });
    });
    const compatBindings = grants.flatMap((grant) => {
      const row = grantFactToCompatBinding({ grant, organizationId });
      return row ? [row] : [];
    });
    await inChunks(compatBindings, (row) => {
      const { id, ...rest } = row;
      return this.prisma.roleBinding.upsert({
        where: { organizationId, id },
        create: row,
        update: rest,
      });
    });
  }

  // Compat head for roles: the same fact under CustomRole's shape. Imported
  // roles keep their CustomRole id, so this upsert writes the row the legacy
  // resolver already reads; ledger-born roles create new ones. Dormant until
  // role events are emitted (PR 2).
  private async upsertRoleHeads({
    organizationId,
    state,
  }: {
    organizationId: string;
    state: GrantsLedgerState;
  }): Promise<void> {
    const roles = Object.values(state.roles);
    await inChunks(roles, (role) => {
      const row = roleFactToRow({ role, organizationId });
      const { id, ...rest } = row;
      return this.prisma.role.upsert({
        where: { organizationId, id },
        create: row,
        update: rest,
      });
    });
    await inChunks(roles, (role) => {
      const compat = {
        name: role.name,
        description: role.description ?? null,
        permissions: role.permissions,
        kind: role.kind,
      };
      return this.prisma.customRole.upsert({
        where: { organizationId, id: role.roleId },
        create: { id: role.roleId, organizationId, ...compat },
        update: compat,
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
    await this.prisma.authzCutoverProjection.upsert({
      where: { organizationId },
      create: {
        organizationId,
        onEngine: state.cutover.onEngine,
        provedAt:
          state.cutover.provedAtMs != null
            ? new Date(state.cutover.provedAtMs)
            : null,
        parityDiffs: state.cutover.parityDiffs,
      },
      update: {
        onEngine: state.cutover.onEngine,
        provedAt:
          state.cutover.provedAtMs != null
            ? new Date(state.cutover.provedAtMs)
            : null,
        parityDiffs: state.cutover.parityDiffs,
      },
    });
  }

  /**
   * The runner-lifecycle head, monotonically guarded: the state table is
   * ALSO written synchronously by the runner (its finalized latch must
   * never wait on a queue), so a lagging fold must never regress a newer
   * direct write. The guard is the row's own `updatedAt`: a folded
   * transition applies only when it is at least as new as what the table
   * already holds. Replay onto a live table therefore converges to no-ops;
   * replay onto an empty table rebuilds it.
   */
  private async writeMigrationStates({
    organizationId,
    state,
  }: {
    organizationId: string;
    state: GrantsLedgerState;
  }): Promise<void> {
    for (const [migrationName, tenantState] of Object.entries(
      state.migrationStates,
    )) {
      const report =
        tenantState.report == null
          ? Prisma.DbNull
          : (tenantState.report as Prisma.InputJsonValue);
      const updated = await this.prisma.systemMigrationTenantState.updateMany({
        where: {
          migrationName,
          tenantId: organizationId,
          updatedAt: { lte: new Date(tenantState.occurredAtMs) },
        },
        data: { status: tenantState.status, report },
      });
      if (updated.count === 0) {
        // Either a newer direct write holds the row (the guard did its
        // job - leave it), or the row does not exist yet (replay onto an
        // empty table) - create it, race-safe against the runner.
        await this.prisma.systemMigrationTenantState.createMany({
          data: [
            {
              migrationName,
              tenantId: organizationId,
              status: tenantState.status,
              report,
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
