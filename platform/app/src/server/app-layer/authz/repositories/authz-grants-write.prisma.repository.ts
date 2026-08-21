/**
 * The authorization read model's writer: one guarded statement per event.
 *
 * The projection decides WHAT to write (a pure function of the event); this
 * decides how. Nothing here reads current state to compute the next — the
 * guard lives in the WHERE clause, so a stale write loses in the database
 * rather than in a read-modify-write race.
 *
 * The guard is on every statement, and its comparison differs by what the
 * write states — which is the whole of how equal timestamps are made safe:
 *
 *   - A write that states the WHOLE row (`attached`, `defined`) must be
 *     strictly newer: `occurredAt < EXCLUDED."occurredAt"`. Two writes can
 *     share a millisecond — `attachBindings` stamps one `occurredAtMs` for a
 *     whole batch — and on equality a full-row write re-states every column,
 *     so admitting it would let a redelivered `attached` revert a same-
 *     millisecond `role_changed` and restore `legacyRole`. That is the
 *     escalation the projection's own comment describes. Refusing on equality
 *     costs nothing: the only same-millisecond full-row write for one grant is
 *     a redelivery of that same event, and re-applying it is a no-op anyway.
 *
 *   - A write that states ONE field (`role_changed`, `revoked`, and the role
 *     equivalents) may tie: `occurredAt <= :occurredAt`. It touches only the
 *     field it names, so applying it on equality cannot revert anything, and
 *     refusing would drop a genuine same-millisecond change.
 *
 * Either way a redelivered OLDER event loses: a re-applied `role_changed`
 * from before a `revoke` matches no row and writes nothing.
 *
 * The two upserts are raw SQL because the guard has to be part of the same
 * statement. Prisma's `upsert` takes no condition on its update branch, so
 * expressing it as read-then-write would reintroduce exactly the race this
 * design removes; `ON CONFLICT DO UPDATE ... WHERE` is atomic.
 */
import {
  grantFactToCompatBinding,
  grantFactToCompatShareLink,
  grantRowToFact,
} from "@langwatch/authz-server";
import { createLogger } from "@langwatch/observability";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import type {
  GrantProjectionWrite,
  GrantProjectionWriteStore,
} from "~/server/event-sourcing/pipelines/authz-grants/projections/authzGrantsWrite.projection";
import { MIGRATION_OWNED_SOURCES } from "../authz-engine.migration";

const logger = createLogger("langwatch:authz:projection-compat");

type GrantRow = Extract<GrantProjectionWrite, { kind: "grant.upsert" }>["row"];
type RoleRow = Extract<GrantProjectionWrite, { kind: "role.upsert" }>["row"];

type PrismaLike = Pick<
  PrismaClient,
  | "grant"
  | "role"
  | "roleBinding"
  | "customRole"
  | "shareLink"
  | "$transaction"
  | "$executeRaw"
>;

/** Exactly the columns `grantRowToFact` reads, so the re-read a compat write
 *  needs cannot drift from the mapper it feeds. */
const GRANT_FACT_COLUMNS = {
  id: true,
  organizationId: true,
  principalType: true,
  principalId: true,
  roleKey: true,
  legacyRole: true,
  source: true,
  scopeType: true,
  scopeId: true,
  token: true,
  permission: true,
  resourceKind: true,
  projectId: true,
  createdByUserId: true,
  expiresAt: true,
  maxViews: true,
  occurredAt: true,
} as const;

/**
 * A partial update that matched no row, said out loud.
 *
 * The four field-setting writes are `updateMany`, which writes nothing when
 * the row is absent instead of failing. Ordinarily the row IS there, because
 * a grant is its own aggregate and the group queue gives one aggregate FIFO
 * delivery (`${tenantId}:${aggregateType}:${aggregateId}`) — an `attached`
 * always lands before the `revoked` that follows it.
 *
 * The exception is a BACK-DATED append: a migration replaying an
 * organization's history states `attached` with the grant's original
 * `occurredAt`, and if it appends that after a live `revoked` for the same
 * grant, the revoke arrives first, matches nothing, and the attach then
 * inserts a live row that no revocation contradicts.
 *
 * There is no honest fix at this layer. A tombstone would need
 * `principalType`, `scopeType` and `scopeId`, none of which a revocation
 * event carries, and inventing them would put a fabricated scope into the
 * table that DECIDES access — worse than the miss. The fix belongs to the
 * migration: it must not state a back-dated `attached` for a grant that has
 * already been revoked. This log is what makes a violation of that findable
 * rather than silent.
 */
function reportMissedRow(write: GrantProjectionWrite, result: unknown): void {
  // Upserts create their own row, so a 0-count is not a miss. A revoke is
  // also skipped, but for a different reason: `appendGrantRevocation` enforces
  // the deny synchronously (enforceGrantRevocation sets `revokedAt` before the
  // event is even queued), so by the time the projection replays the same
  // revoke its `revokedAt: null` guard matches 0 rows on EVERY ordinary
  // revoke — the row is already in the intended state. Reporting that would
  // fire the alarm on every revoke and bury the case it exists for. A
  // genuinely absent revoke is a harmless no-op anyway: the attach that would
  // have created the row is itself an upsert, which this already tolerates.
  if (
    write.kind === "grant.upsert" ||
    write.kind === "role.upsert" ||
    write.kind === "grant.revoke"
  ) {
    return;
  }
  const count = (result as { count?: unknown } | null)?.count;
  if (count !== 0) return;
  logger.warn(
    { write: write.kind, occurredAt: write.occurredAt },
    "authz projection write matched no row; the grant it names is absent or newer",
  );
}

function isMigrationOwnedSource(source: string): boolean {
  return (MIGRATION_OWNED_SOURCES as readonly string[]).includes(source);
}

/** Prisma's codes for "a unique or foreign key says no". */
function isCompatConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2002" || code === "P2003";
}

export class PrismaAuthzGrantsWriteRepository
  implements GrantProjectionWriteStore
{
  constructor(private readonly prisma: PrismaLike) {}

  async append(write: GrantProjectionWrite): Promise<void> {
    const result = await this.statementFor(write);
    reportMissedRow(write, result);
    await this.writeCompatHeads([{ write, result }]);
  }

  async bulkAppend(writes: GrantProjectionWrite[]): Promise<void> {
    // Each write names one row and they are independent, so batching is only
    // about round trips. One transaction keeps a partial batch from leaving
    // the model half-written.
    const results = await this.prisma.$transaction(
      writes.map((write) => this.statementFor(write)),
    );
    writes.forEach((write, index) => reportMissedRow(write, results[index]));
    await this.writeCompatHeads(
      writes.map((write, index) => ({ write, result: results[index] })),
    );
  }

  /**
   * The legacy heads — `RoleBinding`, `ShareLink`, `CustomRole` — kept in step
   * with the authoritative ones.
   *
   * ADR-110 left "whether the projection's compat writes survive at all" open.
   * They survive, because rollback-to-legacy has to stay possible after an
   * organization switches: the legacy resolver, the settings screens, the
   * share tier and the revoke-by-filter path all still read these tables, and
   * an organization whose grants exist only in `Grant` cannot be rolled back
   * to a head that never saw them.
   *
   * Deliberately OUTSIDE the transaction above, and deliberately best-effort.
   * `Grant`/`Role` are the authority and this is a view of them, so a compat
   * row that cannot be written must not fail the authoritative write or park
   * the aggregate's queue lane — a unique or foreign-key conflict here is
   * warned and stepped over, exactly as the fold this replaced did. Anything
   * else still raises.
   *
   * Every compat row shares its grant's id, so an upsert is idempotent and a
   * delete can only ever remove a row the ledger itself authored.
   */
  private async writeCompatHeads(
    entries: Array<{ write: GrantProjectionWrite; result: unknown }>,
  ): Promise<void> {
    for (const { write, result } of entries) {
      try {
        await this.writeCompatHead(write, result);
      } catch (error) {
        if (!isCompatConflict(error)) throw error;
        logger.warn(
          { write: write.kind, error },
          "could not write a compat row; the authoritative head still holds the grant",
        );
      }
    }
  }

  private async writeCompatHead(
    write: GrantProjectionWrite,
    result: unknown,
  ): Promise<void> {
    switch (write.kind) {
      case "grant.upsert":
        // The guard returns the affected-row count. > 0 means this event won
        // and the row now IS its state, so the compat head can be derived from
        // the event with no re-read. 0 means it lost to a newer state already
        // present (a redelivered older attach) — only then must the row be
        // re-read to avoid rebuilding compat from the stale event.
        return this.compatForGrant(write.row, (result as number) > 0);
      case "grant.setRole":
        return this.compatForRoleChange(write.grantId);
      case "grant.revoke":
        return this.compatForRevoke(write.grantId);
      case "role.upsert":
        return this.compatForRole(write.row);
      case "role.setPermissions":
        await this.prisma.customRole.updateMany({
          where: { id: write.roleId },
          data: { permissions: write.permissions as Prisma.InputJsonValue },
        });
        return;
      case "role.delete":
        await this.prisma.customRole.deleteMany({
          where: { id: write.roleId },
        });
        return;
    }
  }

  /** A grant reaches whichever legacy head can express it — a binding, a
   *  share link, or neither. The mappers decide; `null` means the legacy
   *  tables never represented this shape and their silence is correct.
   *
   *  The compat heads are derived from the AUTHORITATIVE row as it stands
   *  after the guarded write, never from the event. A redelivered older
   *  `attached` loses the `occurredAt` guard and leaves the Grant marked
   *  revoked; rebuilding compat from the event would then re-insert the very
   *  binding the revoke deleted, resurrecting access on the legacy head. So
   *  the row is re-read here — the same shape `compatForRoleChange` uses — and
   *  a grant that is absent or revoked has its compat rows removed rather than
   *  written. */
  private async compatForGrant(
    row: GrantRow,
    guardWon: boolean,
  ): Promise<void> {
    const organizationId = row.organizationId;

    // Common path: this event won the guard, so its own row is the
    // authoritative state — derive compat from it directly, no re-read.
    // Only a lost guard (a redelivered older attach) needs the authoritative
    // row read back, because rebuilding compat from the stale event would
    // resurrect a binding a newer revoke deleted.
    if (!guardWon) {
      const authoritative = await this.prisma.grant.findUnique({
        where: { id: row.id },
        select: { ...GRANT_FACT_COLUMNS, revokedAt: true },
      });
      if (!authoritative || authoritative.revokedAt) {
        // Not live — a newer revoke won, or the row is gone. Neither compat
        // head may stand; drop whatever a prior apply left (idempotent when
        // the revoke already deleted it).
        await this.prisma.roleBinding.deleteMany({
          where: { organizationId, id: row.id },
        });
        if (row.projectId) {
          await this.prisma.shareLink.deleteMany({
            where: { projectId: row.projectId, id: row.id },
          });
        }
        return;
      }
      const { revokedAt: _revokedAt, ...factRow } = authoritative;
      return this.upsertCompatForGrant(grantRowToFact(factRow), organizationId);
    }

    return this.upsertCompatForGrant(grantRowToFact(row), organizationId);
  }

  /** Write the binding and share-link compat heads for a live grant fact. */
  private async upsertCompatForGrant(
    grant: ReturnType<typeof grantRowToFact>,
    organizationId: string,
  ): Promise<void> {
    // UPDATE-only for migration-sourced facts (ADR-110: nothing legacy
    // changes before an organization finalizes). An adopted binding or link
    // converges onto the very row it was read from — a byte-identical
    // update — while a fact the legacy schema only inferred (a team
    // membership, the org floor, a project credential) has no row here and
    // must not be given one: its legacy representation is the membership or
    // credential row it came from, and minting a binding for it would be
    // exactly the visible change the migration promises not to make.
    const migrationSourced = isMigrationOwnedSource(grant.source);

    const binding = grantFactToCompatBinding({ grant, organizationId });
    if (binding) {
      const { id, ...rest } = binding;
      if (migrationSourced) {
        await this.prisma.roleBinding.updateMany({
          where: { organizationId, id },
          data: rest,
        });
      } else {
        await this.prisma.roleBinding.upsert({
          where: { organizationId, id },
          create: binding,
          update: rest,
        });
      }
    }

    const link = grantFactToCompatShareLink({ grant, organizationId });
    if (link) {
      const { id, ...rest } = link;
      if (migrationSourced) {
        await this.prisma.shareLink.updateMany({
          where: { projectId: link.projectId, id },
          data: rest,
        });
      } else {
        await this.prisma.shareLink.upsert({
          where: { projectId: link.projectId, id },
          create: link,
          // `viewCount` is named in neither branch: the create leans on the
          // column default and the update leaves the running total alone, so a
          // re-applied attach cannot reset a link's accounting.
          update: rest,
        });
      }
    }
  }

  /**
   * The compat row carries `(role, customRoleId)`, so a roleKey change has to
   * be translated rather than copied. Re-reading the grant and going back
   * through the mapper keeps that translation — including the `legacyRole`
   * rule the reassignment clears — in exactly one place.
   */
  private async compatForRoleChange(grantId: string): Promise<void> {
    const row = await this.prisma.grant.findUnique({
      where: { id: grantId },
      select: GRANT_FACT_COLUMNS,
    });
    if (!row) return;
    const binding = grantFactToCompatBinding({
      grant: grantRowToFact(row),
      organizationId: row.organizationId,
    });
    if (!binding) return;
    await this.prisma.roleBinding.updateMany({
      where: { organizationId: row.organizationId, id: grantId },
      data: { role: binding.role, customRoleId: binding.customRoleId },
    });
  }

  /**
   * The authoritative row is MARKED and the compat row is REMOVED. The legacy
   * tables have nowhere to record "ended", so a surviving row would leave the
   * legacy resolver answering yes to access that has already ended.
   */
  private async compatForRevoke(grantId: string): Promise<void> {
    const row = await this.prisma.grant.findUnique({
      where: { id: grantId },
      select: { organizationId: true, projectId: true },
    });
    if (!row) return;
    await this.prisma.roleBinding.deleteMany({
      where: { organizationId: row.organizationId, id: grantId },
    });
    if (row.projectId) {
      await this.prisma.shareLink.deleteMany({
        where: { projectId: row.projectId, id: grantId },
      });
    }
  }

  private async compatForRole(row: RoleRow): Promise<void> {
    const { id, organizationId, name, description, permissions, kind } = row;
    const compat = { name, description, permissions, kind };
    await this.prisma.customRole.upsert({
      where: { organizationId, id },
      create: { id, organizationId, ...compat },
      update: compat,
    });
  }

  private statementFor(
    write: GrantProjectionWrite,
  ): Prisma.PrismaPromise<unknown> {
    switch (write.kind) {
      case "grant.upsert":
        return this.upsertGrant(write.row);

      case "grant.setRole":
        return this.prisma.grant.updateMany({
          where: { id: write.grantId, occurredAt: { lte: write.occurredAt } },
          // legacyRole is cleared, never carried - see the projection's
          // mapAuthzGrantRoleChanged for the escalation this closes.
          data: {
            roleKey: write.roleKey,
            legacyRole: null,
            occurredAt: write.occurredAt,
          },
        });

      // `revokedAt: null` in the WHERE stops a second revoke moving the
      // first one's timestamp: when access ended is a fact, and the earliest
      // revocation is the true one.
      case "grant.revoke":
        return this.prisma.grant.updateMany({
          where: {
            id: write.grantId,
            revokedAt: null,
            occurredAt: { lte: write.occurredAt },
          },
          data: {
            revokedAt: write.occurredAt,
            revokedReason: write.reason,
            occurredAt: write.occurredAt,
          },
        });

      case "role.upsert":
        return this.upsertRole(write.row);

      case "role.setPermissions":
        return this.prisma.role.updateMany({
          where: { id: write.roleId, occurredAt: { lte: write.occurredAt } },
          data: {
            permissions: write.permissions as Prisma.InputJsonValue,
            occurredAt: write.occurredAt,
          },
        });

      case "role.delete":
        return this.prisma.role.updateMany({
          where: {
            id: write.roleId,
            deletedAt: null,
            occurredAt: { lte: write.occurredAt },
          },
          data: { deletedAt: write.occurredAt, occurredAt: write.occurredAt },
        });
    }
  }

  /**
   * Insert the grant, or update it only when this event is at least as new as
   * the row. The trailing WHERE is the whole point — without it, an `attached`
   * redelivered after a later change would roll the row back to its original
   * state.
   *
   * `revokedAt` is deliberately absent from the update list: a re-delivered
   * attach must not un-revoke a grant, and the row's own revocation is not
   * this event's to state.
   */
  private upsertGrant(row: GrantRow): Prisma.PrismaPromise<number> {
    return this.prisma.$executeRaw`
      INSERT INTO "Grant" (
        "id", "organizationId", "principalType", "principalId", "roleKey",
        "legacyRole", "source", "scopeType", "scopeId", "token", "permission",
        "resourceKind", "projectId", "createdByUserId", "expiresAt",
        "maxViews", "occurredAt", "updatedAt"
      ) VALUES (
        ${row.id}, ${row.organizationId},
        ${row.principalType}::"GrantPrincipalType", ${row.principalId},
        ${row.roleKey}, ${row.legacyRole}, ${row.source},
        ${row.scopeType}::"GrantScopeType", ${row.scopeId}, ${row.token},
        ${row.permission}, ${row.resourceKind}, ${row.projectId},
        ${row.createdByUserId}, ${row.expiresAt}, ${row.maxViews},
        ${row.occurredAt}, NOW()
      )
      ON CONFLICT ("id") DO UPDATE SET
        "organizationId"  = EXCLUDED."organizationId",
        "principalType"   = EXCLUDED."principalType",
        "principalId"     = EXCLUDED."principalId",
        "roleKey"         = EXCLUDED."roleKey",
        "legacyRole"      = EXCLUDED."legacyRole",
        "source"          = EXCLUDED."source",
        "scopeType"       = EXCLUDED."scopeType",
        "scopeId"         = EXCLUDED."scopeId",
        "token"           = EXCLUDED."token",
        "permission"      = EXCLUDED."permission",
        "resourceKind"    = EXCLUDED."resourceKind",
        "projectId"       = EXCLUDED."projectId",
        "createdByUserId" = EXCLUDED."createdByUserId",
        "expiresAt"       = EXCLUDED."expiresAt",
        "maxViews"        = EXCLUDED."maxViews",
        "occurredAt"      = EXCLUDED."occurredAt",
        "updatedAt"       = NOW()
      WHERE "Grant"."occurredAt" < EXCLUDED."occurredAt"
    `;
  }

  /** The same rule for roles. `deletedAt` is left alone for the reason
   *  `revokedAt` is on the grant side. */
  private upsertRole(row: RoleRow): Prisma.PrismaPromise<number> {
    return this.prisma.$executeRaw`
      INSERT INTO "Role" (
        "id", "organizationId", "name", "description", "permissions",
        "kind", "occurredAt", "updatedAt"
      ) VALUES (
        ${row.id}, ${row.organizationId}, ${row.name}, ${row.description},
        ${JSON.stringify(row.permissions)}::jsonb, ${row.kind},
        ${row.occurredAt}, NOW()
      )
      ON CONFLICT ("id") DO UPDATE SET
        "organizationId" = EXCLUDED."organizationId",
        "name"           = EXCLUDED."name",
        "description"    = EXCLUDED."description",
        "permissions"    = EXCLUDED."permissions",
        "kind"           = EXCLUDED."kind",
        "occurredAt"     = EXCLUDED."occurredAt",
        "updatedAt"      = NOW()
      WHERE "Role"."occurredAt" < EXCLUDED."occurredAt"
    `;
  }
}
