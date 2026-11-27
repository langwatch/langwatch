import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { findLedgerStepRecords, type LedgerStepRecord } from "@langwatch/upgrade/reader";

import { SpanAnalyticsFloorRepository } from "../span-analytics-floor.repository.ts";

// The upgrade ledger describes the installation, not a tenant.
const LEDGER_TENANCY = `${skipTenantCheck({ SKIP_TENANT_CHECK: true }).sql}\n`;

/** Reads one replay step's ledger row, by step id, over this process's Postgres. */
export class PrismaSpanAnalyticsFloorRepository extends SpanAnalyticsFloorRepository {
  private constructor(
    private readonly prisma: Pick<PrismaClient, "$queryRawUnsafe">,
    private readonly stepId: string,
  ) {
    super();
  }

  static create({
    prisma,
    stepId,
  }: {
    prisma: Pick<PrismaClient, "$queryRawUnsafe">;
    stepId: string;
  }): PrismaSpanAnalyticsFloorRepository {
    return new PrismaSpanAnalyticsFloorRepository(prisma, stepId);
  }

  findReplayStep(): Promise<LedgerStepRecord[]> {
    const postgres = {
      query: async <Row extends object>(text: string, values: unknown[] = []) => ({
        rows: await this.prisma.$queryRawUnsafe<Row[]>(`${LEDGER_TENANCY}${text}`, ...values),
      }),
    };
    return findLedgerStepRecords({ postgres, id: this.stepId });
  }
}
