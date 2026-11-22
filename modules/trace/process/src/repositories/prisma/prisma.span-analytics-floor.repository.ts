import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { findLedgerStepRecords, type LedgerStepRecord } from "@langwatch/upgrade/reader";

import { SPAN_ANALYTICS_REPLAY_STEP_ID } from "../../rules/trace-widget-columns.rules.ts";
import { SpanAnalyticsFloorRepository } from "../span-analytics-floor.repository.ts";

// The upgrade ledger describes the installation, not a tenant.
const LEDGER_TENANCY = `${skipTenantCheck({ SKIP_TENANT_CHECK: true }).sql}\n`;

/** Reads the span_analytics replay step's ledger row over this process's Postgres. */
export class PrismaSpanAnalyticsFloorRepository extends SpanAnalyticsFloorRepository {
  private constructor(private readonly prisma: Pick<PrismaClient, "$queryRawUnsafe">) {
    super();
  }

  static create(prisma: Pick<PrismaClient, "$queryRawUnsafe">): PrismaSpanAnalyticsFloorRepository {
    return new PrismaSpanAnalyticsFloorRepository(prisma);
  }

  findReplayStep(): Promise<LedgerStepRecord[]> {
    const postgres = {
      query: async <Row extends object>(text: string, values: unknown[] = []) => ({
        rows: await this.prisma.$queryRawUnsafe<Row[]>(`${LEDGER_TENANCY}${text}`, ...values),
      }),
    };
    return findLedgerStepRecords({ postgres, id: SPAN_ANALYTICS_REPLAY_STEP_ID });
  }
}
