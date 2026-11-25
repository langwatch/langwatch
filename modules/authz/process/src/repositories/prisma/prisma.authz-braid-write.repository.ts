import { grantConditionSchema } from "@langwatch/authorization";
import { prismaTables, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, toDate } from "@langwatch/time";

import {
  AuthzBraidWriteRepository,
  type AuthzBraidWrite,
} from "../authz-braid-write.repository.ts";

export type AuthzBraidWriteDatabase = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

type WriteRow = {
  organizationId: string;
  commandId: string;
  grantId: string;
  readerProjectId: string;
  ownerProjectId: string;
  termsKey: string;
  condition: unknown;
  expiresAt: Date | null;
  replacesGrantId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
};

/**
 * ADR-201 §1 Schema: `AuthzBraidWrite`, keyed by organisation and command id. Written outside the
 * reader lock's transaction, so a write survives the request that timed out waiting for it.
 */
export class PrismaAuthzBraidWriteRepository extends AuthzBraidWriteRepository {
  static readonly tables = prismaTables("AuthzBraidWrite");

  static create(options: { database: AuthzBraidWriteDatabase }): PrismaAuthzBraidWriteRepository {
    return new PrismaAuthzBraidWriteRepository(options.database);
  }

  private constructor(private readonly database: AuthzBraidWriteDatabase) {
    super();
  }

  async findByCommand({
    organizationId,
    commandId,
  }: {
    organizationId: string;
    commandId: string;
  }): Promise<AuthzBraidWrite[]> {
    const rows = await this.database.$queryRaw<WriteRow[]>`
      ${skipTenantCheck({
        // Every statement names the organisation the braid write belongs to.
        SKIP_TENANT_CHECK: true,
      })}
      SELECT * FROM "AuthzBraidWrite"
       WHERE "organizationId" = ${organizationId} AND "commandId" = ${commandId}
    `;
    return rows.map(writeOf);
  }

  async findIntoReader({
    organizationId,
    readerProjectId,
  }: {
    organizationId: string;
    readerProjectId: string;
  }): Promise<AuthzBraidWrite[]> {
    const rows = await this.database.$queryRaw<WriteRow[]>`
      ${skipTenantCheck({
        // Every statement names the organisation the braid write belongs to.
        SKIP_TENANT_CHECK: true,
      })}
      SELECT * FROM "AuthzBraidWrite"
       WHERE "organizationId" = ${organizationId}
         AND "readerProjectId" = ${readerProjectId}
       ORDER BY "createdAt" ASC
    `;
    return rows.map(writeOf);
  }

  async create({ write }: { write: AuthzBraidWrite }): Promise<void> {
    await this.database.$executeRaw`
      ${skipTenantCheck({
        // Every statement names the organisation the braid write belongs to.
        SKIP_TENANT_CHECK: true,
      })}
      INSERT INTO "AuthzBraidWrite"
        ("organizationId", "commandId", "grantId", "readerProjectId", "ownerProjectId", "termsKey",
         "condition", "expiresAt", "replacesGrantId", "createdByUserId", "createdAt")
      VALUES (${write.organizationId}, ${write.commandId}, ${write.grantId},
              ${write.readerProjectId}, ${write.ownerProjectId}, ${write.termsKey},
              ${JSON.stringify(write.condition)}::jsonb,
              ${write.expiresAt ? toDate(write.expiresAt) : null}, ${write.replacesGrantId},
              ${write.createdByUserId}, ${toDate(write.createdAt)})
    `;
  }

  async delete({
    organizationId,
    commandId,
  }: {
    organizationId: string;
    commandId: string;
  }): Promise<void> {
    await this.database.$executeRaw`
      ${skipTenantCheck({
        // Every statement names the organisation the braid write belongs to.
        SKIP_TENANT_CHECK: true,
      })}
      DELETE FROM "AuthzBraidWrite"
       WHERE "organizationId" = ${organizationId} AND "commandId" = ${commandId}
    `;
  }
}

function writeOf(row: WriteRow): AuthzBraidWrite {
  return {
    organizationId: row.organizationId,
    commandId: row.commandId,
    grantId: row.grantId,
    readerProjectId: row.readerProjectId,
    ownerProjectId: row.ownerProjectId,
    termsKey: row.termsKey,
    condition: grantConditionSchema.parse(row.condition),
    expiresAt: row.expiresAt ? fromDate(row.expiresAt) : null,
    replacesGrantId: row.replacesGrantId,
    createdByUserId: row.createdByUserId,
    createdAt: fromDate(row.createdAt),
  };
}
