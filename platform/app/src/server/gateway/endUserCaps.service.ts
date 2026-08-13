/**
 * The per-person allowances that apply to one end user, with the spend each
 * has already taken this period.
 *
 * A service rather than route-local code because it is a read across two
 * stores: the templates and their bucket boundaries in Postgres, the spend
 * in the ClickHouse ledger. The route's job is to answer HTTP; deciding
 * which templates apply and which period their figures cover is business
 * logic, and it is the same logic whichever surface asks for it.
 */
import type { PrismaClient } from "@prisma/client";

import type { GatewayBudgetClickHouseRepository } from "./budget.clickhouse.repository";
import { bucketPeriodFloorMs, effectiveBudgetPeriod } from "./budgetPeriod";
import {
  attributedUserBucketScopeId,
  bucketScopeIdFor,
} from "./budgetResolution.service";
import { toWireEnum } from "./wireEnums";
import { usdDisplayString } from "./wireMoney";

/**
 * The applicable caps for one end user: every attributed-user template in
 * the org (optionally narrowed by anchor key), each with its CURRENT
 * PERIOD spend from the budget ledger, boundary-aware. This is the pair a
 * rebilling platform polls at period close; the usage rollup served
 * beside it is the billing-events view of the same user over the asked
 * window, so the two figures deliberately cover different periods.
 */
export async function applicableEndUserCaps({
  prisma,
  budgetRepository,
  organizationId,
  endUserId,
  tenantIds,
  virtualKeyId,
}: {
  prisma: PrismaClient;
  /**
   * The budget ledger, from the App. Passed in rather than resolved here so
   * this function keeps one way to reach ClickHouse and the caller cannot
   * accidentally give it a different client than the rest of the request.
   */
  budgetRepository: GatewayBudgetClickHouseRepository;
  organizationId: string;
  endUserId: string;
  tenantIds: string[];
  virtualKeyId?: string;
}): Promise<Array<Record<string, unknown>>> {
  const templates = await prisma.gatewayBudget.findMany({
    where: {
      organizationId,
      scopeType: "ATTRIBUTED_USER",
      archivedAt: null,
      ...(virtualKeyId ? { scopeId: virtualKeyId } : {}),
    },
  });
  if (templates.length === 0 || tenantIds.length === 0) return [];

  const boundaries = await prisma.gatewayBudgetBucketBoundary.findMany({
    where: {
      organizationId,
      budgetId: { in: templates.map((t) => t.id) },
    },
  });
  const boundaryByKey = new Map(
    boundaries.map((b) => [`${b.budgetId}:${b.bucketScopeId}`, b]),
  );
  const bucketFor = (t: (typeof templates)[number]) =>
    bucketScopeIdFor(t, attributedUserBucketScopeId(t.scopeId, endUserId));

  const budgetCH = budgetRepository;
  // One instant for the whole answer: the floor the spend is read from and
  // the period it is reported under have to be the same period.
  const now = new Date();
  const targets = templates.map((t) => {
    const bucketScopeId = bucketFor(t);
    const bucketBoundary = boundaryByKey.get(`${t.id}:${bucketScopeId}`);
    return {
      budgetId: t.id,
      scope: t.scopeType,
      scopeId: bucketScopeId,
      window: t.window,
      match: "exact" as const,
      periodFloorMs: bucketPeriodFloorMs(
        t,
        bucketBoundary?.periodStartedAt,
        now,
      ),
    };
  });
  const spends = await budgetCH.getSpendForTargetsAcrossTenants(
    tenantIds,
    targets,
    now,
  );
  const spentByBudget = new Map(spends.map((sp) => [sp.budgetId, sp.spentUsd]));
  return templates.map((t) => {
    const bucketBoundary = boundaryByKey.get(`${t.id}:${bucketFor(t)}`);
    return {
      budget_id: t.id,
      anchor_id: t.scopeId,
      // Lowercase like every other enum under /api/gateway/v1. These two were
      // passing Prisma's casing straight through, so the same prefix served
      // `"MONTH"` here and `"month"` from the platform routes.
      window: toWireEnum(t.window),
      on_breach: toWireEnum(t.onBreach),
      limit_usd: usdDisplayString(t.limitUsd),
      spent_usd: usdDisplayString(spentByBudget.get(t.id) ?? "0"),
      // The exact bound `spent_usd` was summed from, so a rebilling caller
      // can reconcile the figure against the period it names. The stored
      // column would say the template's creation date on every cycle after
      // the first.
      period_started_at: new Date(
        bucketPeriodFloorMs(t, bucketBoundary?.periodStartedAt, now) ??
          effectiveBudgetPeriod(t, now).currentPeriodStartedAt.getTime(),
      ).toISOString(),
    };
  });
}
