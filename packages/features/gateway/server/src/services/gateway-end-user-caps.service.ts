import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { bucketPeriodFloorMs, effectiveBudgetPeriod } from "../adapters/gateway-period.adapter";
import {
  attributedUserBucketScopeId,
  bucketScopeIdFor,
} from "../repositories/prisma/prisma.gateway-budget-resolution.repository";
import { toWireEnum } from "../adapters/gateway-wire-enums.adapter";
import { usdDisplayString } from "../adapters/gateway-wire-money.adapter";
import type { GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port";

/** Reads the current attributed-user budget allowances and their ledger spend. */
export async function applicableEndUserCaps(input: {
  prisma: PrismaClient;
  budgetRepository: GatewayBudgetSpendPort;
  organizationId: string;
  endUserId: string;
  tenantIds: string[];
  virtualKeyId?: string;
}): Promise<Array<Record<string, unknown>>> {
  const templates = await input.prisma.gatewayBudget.findMany({
    where: {
      organizationId: input.organizationId,
      scopeType: "ATTRIBUTED_USER",
      archivedAt: null,
      ...(input.virtualKeyId ? { scopeId: input.virtualKeyId } : {}),
    },
  });
  if (templates.length === 0 || input.tenantIds.length === 0) {
    return [];
  }

  const boundaries = await input.prisma.gatewayBudgetBucketBoundary.findMany({
    where: {
      organizationId: input.organizationId,
      budgetId: { in: templates.map((template) => template.id) },
    },
  });
  const boundaryByKey = new Map(
    boundaries.map((boundary) => [`${boundary.budgetId}:${boundary.bucketScopeId}`, boundary]),
  );
  const bucketFor = (template: (typeof templates)[number]) =>
    bucketScopeIdFor(template, attributedUserBucketScopeId(template.scopeId, input.endUserId));

  const now = new Date();
  const targets = templates.map((template) => {
    const bucketScopeId = bucketFor(template);
    const boundary = boundaryByKey.get(`${template.id}:${bucketScopeId}`);
    return {
      budgetId: template.id,
      scope: template.scopeType,
      scopeId: bucketScopeId,
      window: template.window,
      match: "exact" as const,
      periodFloorMs: bucketPeriodFloorMs(template, boundary?.periodStartedAt, now),
    };
  });
  const spends = await input.budgetRepository.getSpendForTargetsAcrossTenants(
    input.tenantIds,
    targets,
    now,
  );
  const spentByBudget = new Map(spends.map((spend) => [spend.budgetId, spend.spentUsd]));

  return templates.map((template) => {
    const boundary = boundaryByKey.get(`${template.id}:${bucketFor(template)}`);
    const periodFloorMs = bucketPeriodFloorMs(template, boundary?.periodStartedAt, now);
    return {
      budget_id: template.id,
      anchor_id: template.scopeId,
      window: toWireEnum(template.window),
      on_breach: toWireEnum(template.onBreach),
      limit_usd: usdDisplayString(template.limitUsd),
      spent_usd: usdDisplayString(spentByBudget.get(template.id) ?? "0"),
      period_started_at: new Date(
        periodFloorMs ?? effectiveBudgetPeriod(template, now).currentPeriodStartedAt.getTime(),
      ).toISOString(),
    };
  });
}
