// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Row access for the key-to-bill coverage mapping (ADR-128 §7). Every
 * `prisma.ingestionSourceKeyCoverage.*` call lives here; the service owns the
 * guards and the words an administrator reads.
 *
 * Scoped by `organizationId`, like every other governance table — the hidden
 * governance project's id can be archived out from under a row, and this
 * mapping outlives any one of them.
 *
 * Spec: specs/governance/governance-cost-coverage.feature
 */
import type { Prisma, PrismaClient } from "~/generated/prisma/client";

type Client = Prisma.TransactionClient | PrismaClient;

/** One period during which one bill paid for one gateway key. */
export interface CoveragePeriod {
  id: string;
  ingestionSourceId: string;
  virtualKeyId: string;
  validFrom: Date;
  validTo: Date | null;
}

export class IngestionSourceKeyCoverageRepository {
  /**
   * Every period an organization has recorded, oldest first.
   *
   * The whole history, not just the open rows: a chart of last March has to
   * resolve the bill that covered March, and that period may have been closed
   * since.
   */
  findAllByOrganization(
    client: Client,
    params: { organizationId: string },
  ): Promise<CoveragePeriod[]> {
    return client.ingestionSourceKeyCoverage.findMany({
      where: { organizationId: params.organizationId },
      select: COVERAGE_FIELDS,
      orderBy: [{ virtualKeyId: "asc" }, { validFrom: "asc" }],
    });
  }

  /** One bill's periods, for the list shown beside its configuration. */
  findAllBySource(
    client: Client,
    params: { organizationId: string; ingestionSourceId: string },
  ): Promise<CoveragePeriod[]> {
    return client.ingestionSourceKeyCoverage.findMany({
      where: {
        organizationId: params.organizationId,
        ingestionSourceId: params.ingestionSourceId,
      },
      select: COVERAGE_FIELDS,
      orderBy: [{ virtualKeyId: "asc" }, { validFrom: "asc" }],
    });
  }

  /**
   * The key's currently-open period, locked for update, or null when no bill
   * covers it.
   *
   * `FOR UPDATE` is the whole point and it is why this is raw SQL: closing one
   * period and opening its successor has to be one movement, and a plain read
   * lets a second administrator interleave between the two writes — closing the
   * open row and opening a successor an hour later, leaving an hour of that
   * key's spend covered by no bill, with nothing raised and nothing to find it
   * afterwards. The exclusion constraint cannot see that gap; it can only see
   * an overlap. Holding the row for the length of the transaction is what makes
   * the gap unrepresentable.
   *
   * Must be called inside a transaction. Outside one the lock is released the
   * instant the statement returns, which is a lock that proves nothing.
   */
  async findOpenForUpdate(
    tx: Prisma.TransactionClient,
    params: { organizationId: string; virtualKeyId: string },
  ): Promise<CoveragePeriod | null> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        ingestionSourceId: string;
        virtualKeyId: string;
        validFrom: Date;
        validTo: Date | null;
      }>
    >`
      SELECT "id", "ingestionSourceId", "virtualKeyId", "validFrom", "validTo"
      FROM "IngestionSourceKeyCoverage"
      WHERE "organizationId" = ${params.organizationId}
        AND "virtualKeyId" = ${params.virtualKeyId}
        AND "validTo" IS NULL
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  /** Records a bill as covering a key from an instant onward. */
  async open(
    client: Client,
    params: {
      organizationId: string;
      ingestionSourceId: string;
      virtualKeyId: string;
      validFrom: Date;
    },
  ): Promise<CoveragePeriod> {
    return await client.ingestionSourceKeyCoverage.create({
      data: {
        organizationId: params.organizationId,
        ingestionSourceId: params.ingestionSourceId,
        virtualKeyId: params.virtualKeyId,
        validFrom: params.validFrom,
      },
      select: COVERAGE_FIELDS,
    });
  }

  /**
   * Ends a period at an instant.
   *
   * Addressed by id and still bounded by organization: the id came from a read
   * this organization made, and naming the organization again is what keeps a
   * stale id from reaching across tenants.
   */
  async close(
    client: Client,
    params: { organizationId: string; id: string; validTo: Date },
  ): Promise<void> {
    await client.ingestionSourceKeyCoverage.updateMany({
      where: { organizationId: params.organizationId, id: params.id },
      data: { validTo: params.validTo },
    });
  }
}

const COVERAGE_FIELDS = {
  id: true,
  ingestionSourceId: true,
  virtualKeyId: true,
  validFrom: true,
  validTo: true,
} as const;
