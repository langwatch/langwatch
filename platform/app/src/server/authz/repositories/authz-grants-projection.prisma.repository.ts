import {
  type GrantsLedgerState,
  grantFactToCompatBinding,
  grantFactToRow,
  grantRowToFact,
  roleFactToRow,
  roleRowToFact,
} from "@langwatch/authz-server";
import type { PrismaClient } from "~/generated/prisma/client";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";

const UPSERT_CHUNK = 25;

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
  implements StateProjectionStore<GrantsLedgerState>
{
  constructor(private readonly prisma: PrismaClient) {}

  async load(
    key: string,
    _context: ProjectionStoreContext,
  ): Promise<StoredProjection<GrantsLedgerState> | null> {
    const organizationId = key;
    const cursor = await this.prisma.authzProjectionCursor.findUnique({
      where: { organizationId },
    });
    if (!cursor) return null;

    const [grantRows, roleRows, cutover] = await Promise.all([
      this.prisma.grant.findMany({ where: { organizationId } }),
      this.prisma.role.findMany({ where: { organizationId } }),
      this.prisma.authzCutoverProjection.findUnique({
        where: { organizationId },
      }),
    ]);

    const state: GrantsLedgerState = {
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

  async store(
    projection: StoredProjection<GrantsLedgerState>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const organizationId = context.aggregateId;
    const { state } = projection;
    await this.removeDepartedFacts({ organizationId, state });
    await this.upsertGrantHeads({ organizationId, state });
    await this.upsertRoleHeads({ organizationId, state });
    await this.writeCutover({ organizationId, state });
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
