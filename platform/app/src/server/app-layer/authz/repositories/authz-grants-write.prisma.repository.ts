/**
 * The authorization read model's writer: one guarded statement per event.
 *
 * The projection decides WHAT to write (a pure function of the event); this
 * decides how. Nothing here reads current state to compute the next — the
 * guard lives in the WHERE clause, so a stale write loses in the database
 * rather than in a read-modify-write race.
 *
 * The guard is `occurredAt <= :occurredAt` on every statement. Events are
 * delivered at least once, and a redelivered older event must not undo a
 * newer one: a re-applied `role_changed` from before a `revoke` matches no
 * row and writes nothing.
 *
 * The two upserts are raw SQL because the guard has to be part of the same
 * statement. Prisma's `upsert` takes no condition on its update branch, so
 * expressing it as read-then-write would reintroduce exactly the race this
 * design removes; `ON CONFLICT DO UPDATE ... WHERE` is atomic.
 */
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import type {
  GrantProjectionWrite,
  GrantProjectionWriteStore,
} from "~/server/event-sourcing/pipelines/authz-grants/projections/authzGrantsWrite.projection";

type GrantRow = Extract<GrantProjectionWrite, { kind: "grant.upsert" }>["row"];
type RoleRow = Extract<GrantProjectionWrite, { kind: "role.upsert" }>["row"];

type PrismaLike = Pick<
  PrismaClient,
  "grant" | "role" | "$transaction" | "$executeRaw"
>;

export class PrismaAuthzGrantsWriteRepository
  implements GrantProjectionWriteStore
{
  constructor(private readonly prisma: PrismaLike) {}

  async append(write: GrantProjectionWrite): Promise<void> {
    await this.statementFor(write);
  }

  async bulkAppend(writes: GrantProjectionWrite[]): Promise<void> {
    // Each write names one row and they are independent, so batching is only
    // about round trips. One transaction keeps a partial batch from leaving
    // the model half-written.
    await this.prisma.$transaction(
      writes.map((write) => this.statementFor(write)),
    );
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
      WHERE "Grant"."occurredAt" <= EXCLUDED."occurredAt"
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
      WHERE "Role"."occurredAt" <= EXCLUDED."occurredAt"
    `;
  }
}
