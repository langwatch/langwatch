// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, toDate, type Instant } from "@langwatch/time";

import { OverPlanRepository, type OverPlanMark } from "../over-plan.repository.ts";

type OverPlanDatabase = Pick<PrismaClient, "subscription" | "$executeRaw">;

const MARK_COLUMNS = { id: true, organizationId: true, overPlanSince: true } as const;

type MarkRow = { id: string; organizationId: string; overPlanSince: Date | null };

export class PrismaOverPlanRepository extends OverPlanRepository {
  private constructor(private readonly prisma: OverPlanDatabase) {
    super();
  }

  static create(prisma: OverPlanDatabase): PrismaOverPlanRepository {
    return new PrismaOverPlanRepository(prisma);
  }

  async mark({ subscriptionId, since }: { subscriptionId: string; since: Instant }): Promise<void> {
    await this.prisma.$executeRaw`
      ${skipTenantCheck({
        // A subscription row is addressed by its own primary key.
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "Subscription"
         SET "overPlanSince" = ${toDate(since)},
             "overPlanEndedAt" = NULL
       WHERE "id" = ${subscriptionId}
    `;
  }

  async end({
    subscriptionId,
    endedAt,
  }: {
    subscriptionId: string;
    endedAt: Instant;
  }): Promise<boolean> {
    const ended = await this.prisma.$executeRaw`
      ${skipTenantCheck({
        // A subscription row is addressed by its own primary key.
        SKIP_TENANT_CHECK: true,
      })}
      UPDATE "Subscription"
         SET "overPlanEndedAt" = ${toDate(endedAt)}
       WHERE "id" = ${subscriptionId}
         AND "overPlanSince" IS NOT NULL
         AND "overPlanEndedAt" IS NULL
    `;
    return ended === 1;
  }

  async findOpen(): Promise<OverPlanMark[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { overPlanSince: { not: null }, overPlanEndedAt: null },
      select: MARK_COLUMNS,
      orderBy: [{ overPlanSince: "asc" }, { id: "asc" }],
    });
    return marksOf(rows);
  }

  async findOpenForOrganization(organizationId: string): Promise<OverPlanMark[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { organizationId, overPlanSince: { not: null }, overPlanEndedAt: null },
      select: MARK_COLUMNS,
      orderBy: [{ overPlanSince: "desc" }, { id: "asc" }],
    });
    return marksOf(rows);
  }
}

function marksOf(rows: readonly MarkRow[]): OverPlanMark[] {
  return rows.flatMap((row) =>
    row.overPlanSince
      ? [
          {
            subscriptionId: row.id,
            organizationId: row.organizationId,
            since: fromDate(row.overPlanSince),
          },
        ]
      : [],
  );
}
