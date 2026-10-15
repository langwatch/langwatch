import type { PrismaClient, TestingLicenseToken } from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import type {
  TestingLicenseTokenDraft,
  TestingLicenseTokenRecord,
  TestingLicenseTokenRepository,
} from "../testing-license-token.repository.ts";

type TestingLicenseTokenDatabase = Pick<PrismaClient, "testingLicenseToken">;

export class PrismaTestingLicenseTokenRepository implements TestingLicenseTokenRepository {
  static create(database: TestingLicenseTokenDatabase): PrismaTestingLicenseTokenRepository {
    return new PrismaTestingLicenseTokenRepository(database);
  }

  private constructor(private readonly prisma: TestingLicenseTokenDatabase) {}

  async create(draft: TestingLicenseTokenDraft): Promise<TestingLicenseTokenRecord> {
    return rowOf(
      await this.prisma.testingLicenseToken.create({
        data: { ...draft, expiresAt: toDate(draft.expiresAt) },
      }),
    );
  }

  async findByTokenHash(tokenHash: string): Promise<TestingLicenseTokenRecord[]> {
    const row = await this.prisma.testingLicenseToken.findUnique({ where: { tokenHash } });
    return row === null ? [] : [rowOf(row)];
  }

  async findById(id: string): Promise<TestingLicenseTokenRecord[]> {
    const row = await this.prisma.testingLicenseToken.findUnique({ where: { id } });
    return row === null ? [] : [rowOf(row)];
  }

  async listAll({
    page,
    pageSize,
  }: {
    page: number;
    pageSize: number;
  }): Promise<{ rows: TestingLicenseTokenRecord[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.testingLicenseToken.findMany({
        orderBy: { createdAt: "desc" },
        skip: page * pageSize,
        take: pageSize,
      }),
      this.prisma.testingLicenseToken.count(),
    ]);
    return { rows: rows.map(rowOf), total };
  }

  async revoke({
    id,
    at,
    revokedById,
  }: {
    id: string;
    at: Instant;
    revokedById: string;
  }): Promise<boolean> {
    const updated = await this.prisma.testingLicenseToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: toDate(at), revokedById },
    });
    return updated.count === 1;
  }

  async recordUse({ id, at }: { id: string; at: Instant }): Promise<void> {
    await this.prisma.testingLicenseToken.updateMany({
      where: { id },
      data: { lastUsedAt: toDate(at) },
    });
  }
}

/** Prisma speaks `Date`; the feature speaks `Instant`. The hash never leaves this file. */
function rowOf({ tokenHash: _tokenHash, ...row }: TestingLicenseToken): TestingLicenseTokenRecord {
  return {
    ...row,
    kind: row.kind === "service" ? "service" : "personal",
    expiresAt: fromDate(row.expiresAt),
    revokedAt: row.revokedAt === null ? null : fromDate(row.revokedAt),
    lastUsedAt: row.lastUsedAt === null ? null : fromDate(row.lastUsedAt),
    createdAt: fromDate(row.createdAt),
  };
}
