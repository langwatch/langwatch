// Guarded upserts in raw SQL; one statement per event; guard in WHERE for atomicity.
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate } from "@langwatch/time";

import {
  type GrantProjectionWrite,
  GrantProjectionWriteStore,
} from "../../eventing/authz-grant.projection.ts";
import { AuthzMigrationOwnershipMapper } from "../../migrations/legacy-import.authz-grant.migration.ts";
import { AuthzGrantMapper } from "./prisma.authz-grant.mapper.ts";

const logger = createLogger("langwatch:authz:projection-compat");

type GrantRow = Extract<GrantProjectionWrite, { kind: "grant.upsert" }>["row"];
type RoleRow = Extract<GrantProjectionWrite, { kind: "role.upsert" }>["row"];

type ProjectionDelegate = {
  findUnique(args: unknown): Promise<any>;
  updateMany(args: unknown): Promise<any>;
  deleteMany(args: unknown): Promise<any>;
  upsert(args: unknown): Promise<any>;
};

type ProjectionDatabase = {
  grant: ProjectionDelegate;
  role: ProjectionDelegate;
  roleBinding: ProjectionDelegate;
  customRole: ProjectionDelegate;
  shareLink: ProjectionDelegate;
  $transaction(writes: Promise<unknown>[]): Promise<unknown[]>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};

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

// Back-dated migrations may append after revoke; migration must enforce ordering.
class AuthzProjectionResultMapper {
  static reportMissedRow(write: GrantProjectionWrite, result: unknown): void {
    // Upserts create their own row, so a 0-count is not a miss. A revoke is
    // also skipped, but for a different reason: direct enforcement has
    // already applied the deny before projection delivery.
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
      { write: write.kind, occurredAt: write.occurredAt.toString({ fractionalSecondDigits: 3 }) },
      "authz projection write matched no row; the grant it names is absent or newer",
    );
  }

  /** Prisma's codes for "a unique or foreign key says no". */
  static isCompatConflict(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    return code === "P2002" || code === "P2003";
  }
}

// Structural type for five models; composition root adapts client once.
export type AuthzProjectionDatabase = Pick<
  PrismaClient,
  "grant" | "role" | "roleBinding" | "customRole" | "shareLink" | "$transaction" | "$executeRaw"
>;

export class PrismaAuthzProjectionRepository extends GrantProjectionWriteStore {
  static create(database: AuthzProjectionDatabase): PrismaAuthzProjectionRepository {
    return new PrismaAuthzProjectionRepository(database as unknown as ProjectionDatabase);
  }

  private constructor(private readonly prisma: ProjectionDatabase) {
    super();
  }

  async append(write: GrantProjectionWrite): Promise<void> {
    const result = await this.statementFor(write);
    AuthzProjectionResultMapper.reportMissedRow(write, result);
    await this.writeCompatHeads([{ write, result }]);
  }

  async bulkAppend(writes: GrantProjectionWrite[]): Promise<void> {
    // Each write names one row and they are independent, so batching is only
    // about round trips. One transaction keeps a partial batch from leaving
    // the model half-written.
    const results = await this.prisma.$transaction(writes.map((write) => this.statementFor(write)));
    writes.forEach((write, index) =>
      AuthzProjectionResultMapper.reportMissedRow(write, results[index]),
    );
    await this.writeCompatHeads(writes.map((write, index) => ({ write, result: results[index] })));
  }

  // Compat heads kept for rollback-to-legacy; outside transaction, conflicts best-effort.
  private async writeCompatHeads(
    entries: { write: GrantProjectionWrite; result: unknown }[],
  ): Promise<void> {
    for (const { write, result } of entries) {
      try {
        await this.writeCompatHead(write, result);
      } catch (error) {
        if (!AuthzProjectionResultMapper.isCompatConflict(error)) throw error;
        logger.warn(
          { write: write.kind, error },
          "could not write a compat row; the authoritative head still holds the grant",
        );
      }
    }
  }

  private async writeCompatHead(write: GrantProjectionWrite, result: unknown): Promise<void> {
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
          data: { permissions: write.permissions },
        });
        return;
      case "role.delete":
        await this.prisma.customRole.deleteMany({
          where: { id: write.roleId },
        });
        return;
    }
  }

  // Compat from authoritative row post-guard prevents resurrecting revoked bindings.
  private async compatForGrant(row: GrantRow, guardWon: boolean): Promise<void> {
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
      return this.upsertCompatForGrant(AuthzGrantMapper.grantRowToFact(factRow), organizationId);
    }

    return this.upsertCompatForGrant(AuthzGrantMapper.grantRowToFact(row), organizationId);
  }

  /** Write the binding and share-link compat heads for a live grant fact. */
  private async upsertCompatForGrant(
    grant: ReturnType<typeof AuthzGrantMapper.grantRowToFact>,
    organizationId: string,
  ): Promise<void> {
    // UPDATE-only for migration-sourced facts (ADR-110: nothing legacy
    // changes before an organization finalizes). An adopted binding or link
    // converges onto its own row - a byte-identical update - while a fact the
    // legacy schema only inferred has no row here and must not be given one.
    const migrationSourced = AuthzMigrationOwnershipMapper.includes(grant.source);

    const binding = AuthzGrantMapper.findCompatBindingFromGrantFact({ grant, organizationId });
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

    const link = AuthzGrantMapper.findCompatShareLinkFromGrantFact({ grant, organizationId });
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
   * The compat row carries `(role, customRoleId)`, so a roleKey change must
   * be translated, not copied. Re-reading the grant and going back through
   * the mapper keeps that translation, including `legacyRole`, in one place.
   */
  private async compatForRoleChange(grantId: string): Promise<void> {
    const row = await this.prisma.grant.findUnique({
      where: { id: grantId },
      select: GRANT_FACT_COLUMNS,
    });
    if (!row) return;
    const binding = AuthzGrantMapper.findCompatBindingFromGrantFact({
      grant: AuthzGrantMapper.grantRowToFact(row),
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

  private statementFor(write: GrantProjectionWrite): Promise<unknown> {
    switch (write.kind) {
      case "grant.upsert":
        return this.upsertGrant(write.row, write.membershipStamp, write.membershipBootstrap);

      case "grant.setRole":
        return this.prisma.grant.updateMany({
          where: { id: write.grantId, occurredAt: { lte: toDate(write.occurredAt) } },
          // legacyRole is cleared, never carried - see the projection's
          // mapAuthzGrantRoleChanged for the escalation this closes.
          data: {
            roleKey: write.roleKey,
            legacyRole: null,
            occurredAt: toDate(write.occurredAt),
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
            occurredAt: { lte: toDate(write.occurredAt) },
          },
          data: {
            revokedAt: toDate(write.occurredAt),
            revokedReason: write.reason,
            occurredAt: toDate(write.occurredAt),
          },
        });

      case "role.upsert":
        return this.upsertRole(write.row);

      case "role.setPermissions":
        return this.prisma.role.updateMany({
          where: { id: write.roleId, occurredAt: { lte: toDate(write.occurredAt) } },
          data: {
            permissions: write.permissions,
            occurredAt: toDate(write.occurredAt),
          },
        });

      case "role.delete":
        return this.prisma.role.updateMany({
          where: {
            id: write.roleId,
            deletedAt: null,
            occurredAt: { lte: toDate(write.occurredAt) },
          },
          data: { deletedAt: toDate(write.occurredAt), occurredAt: toDate(write.occurredAt) },
        });
    }
  }

  /**
   * Guarded upsert with trailing WHERE; redelivered attach must not un-revoke.
   * The leading WHERE is the membership fence: a USER grant only enters while
   * the lifetime it was stamped against is still the live one.
   */
  private upsertGrant(
    row: GrantRow,
    membershipStamp: string | undefined,
    membershipBootstrap: boolean | undefined,
  ): Promise<number> {
    const stamp = membershipStamp ?? null;
    const bootstrapScopeIsAllowed =
      row.scopeType === "TEAM" ||
      (row.scopeType === "ORGANIZATION" && row.scopeId === row.organizationId);
    return this.prisma.$executeRaw`
      INSERT INTO "Grant" (
        "id", "organizationId", "principalType", "principalId", "roleKey",
        "legacyRole", "source", "scopeType", "scopeId", "token", "permission",
        "resourceKind", "projectId", "createdByUserId", "expiresAt",
        "maxViews", "occurredAt", "updatedAt"
      ) SELECT
        ${row.id}, ${row.organizationId},
        ${row.principalType}::"GrantPrincipalType", ${row.principalId},
        ${row.roleKey}, ${row.legacyRole}, ${row.source},
        ${row.scopeType}::"GrantScopeType", ${row.scopeId}, ${row.token},
        ${row.permission}, ${row.resourceKind}, ${row.projectId},
        ${row.createdByUserId}, ${row.expiresAt ? toDate(row.expiresAt) : null}, ${row.maxViews},
        ${toDate(row.occurredAt)}, NOW()
      WHERE (
        ${stamp}::text IS NULL
        OR ${row.principalType}::text <> 'USER'
        OR EXISTS (
          SELECT 1
          FROM "OrganizationUser"
          WHERE "organizationId" = ${row.organizationId}
            AND "userId" = ${row.principalId}
            AND "membershipStamp" = ${stamp}::text
          FOR UPDATE
        )
        OR (
          ${membershipBootstrap ?? false}::boolean
          AND ${row.roleKey === "admin"}::boolean
          AND ${bootstrapScopeIsAllowed}::boolean
          AND NOT EXISTS (
            SELECT 1 FROM "Organization" WHERE "id" = ${row.organizationId}
          )
        )
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
  private upsertRole(row: RoleRow): Promise<number> {
    return this.prisma.$executeRaw`
      INSERT INTO "Role" (
        "id", "organizationId", "name", "description", "permissions",
        "kind", "occurredAt", "updatedAt"
      ) VALUES (
        ${row.id}, ${row.organizationId}, ${row.name}, ${row.description},
        ${JSON.stringify(row.permissions)}::jsonb, ${row.kind},
        ${toDate(row.occurredAt)}, NOW()
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
