// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import type { GatewayBudget, PrismaClient, VirtualKey } from "@prisma/client";
import { getApp } from "~/server/app-layer/app";
import { GOVERNANCE_EVENTS_PIPELINE_NAME } from "~/server/event-sourcing/pipelines/governance-events/schemas/constants";
import type {
  BudgetCrossingKind,
  RecordBudgetCrossingCommandData,
  RecordVkLifecycleCommandData,
  VkLifecycleAction,
} from "~/server/event-sourcing/pipelines/governance-events/schemas/commands";
import {
  budgetPeriodFloorMs,
  currentPeriodStart,
  type GatewayBudgetClickHouseRepository,
} from "~/server/gateway/budget.clickhouse.repository";
import { SoftWarnPercent } from "./governanceSignals.constants";

const logger = createLogger("langwatch:governance:signals");

/**
 * Emission seams for the governance webhook families. Everything here is
 * BEST EFFORT by contract: a governance signal is a notification, and no
 * mutation or debit may ever fail because its notification could not be
 * appended. The store-level idempotency keys make every retry safe.
 */

function governanceCommands():
  | Record<
      string,
      { send: (payload: unknown) => Promise<unknown> }
    >
  | null {
  try {
    const pipeline = getApp().eventSourcing?.getPipeline(
      GOVERNANCE_EVENTS_PIPELINE_NAME,
    );
    return (pipeline?.commands as never) ?? null;
  } catch {
    return null;
  }
}

/** One org project id, for event-log tenancy and delivery bookkeeping. */
async function tenantProjectId(
  prisma: PrismaClient,
  organizationId: string,
  preferredProjectId?: string | null,
): Promise<string | null> {
  if (preferredProjectId) return preferredProjectId;
  const project = await prisma.project.findFirst({
    where: { team: { organizationId } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return project?.id ?? null;
}

export async function emitVkLifecycle(
  prisma: PrismaClient,
  vk: Pick<
    VirtualKey,
    "id" | "organizationId" | "name" | "displayPrefix" | "traceProjectId"
  >,
  action: VkLifecycleAction,
  reason?: string | null,
): Promise<void> {
  try {
    const commands = governanceCommands();
    if (!commands?.recordVkLifecycle) return;
    const tenantId = await tenantProjectId(
      prisma,
      vk.organizationId,
      vk.traceProjectId,
    );
    if (!tenantId) return;
    const payload: RecordVkLifecycleCommandData = {
      tenantId,
      organization_id: vk.organizationId,
      virtual_key_id: vk.id,
      action,
      name: vk.name,
      display_prefix: vk.displayPrefix,
      reason: reason ?? null,
      occurred_at: Date.now(),
    };
    await commands.recordVkLifecycle.send(payload);
  } catch (error) {
    logger.warn(
      { virtualKeyId: vk.id, action, error },
      "failed to append vk lifecycle governance event (best effort)",
    );
  }
}

export interface CrossingCandidateRow {
  tenantId: string;
  budgetId: string;
  bucketScopeId: string;
  endUserId: string | null;
}

/**
 * Post-debit crossing detection. Reads the written buckets' current-period
 * spend (boundary-aware), compares against each budget's warn threshold
 * and limit, and appends threshold/breach crossings. The command store's
 * (budget, bucket, kind, period) idempotency key collapses repeats, so
 * calling this after every debit write is exactly the
 * once-per-crossing-per-period rule.
 */
export async function detectBudgetCrossings(
  deps: {
    prisma: PrismaClient;
    budgetCHRepository: GatewayBudgetClickHouseRepository;
  },
  rows: CrossingCandidateRow[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const commands = governanceCommands();
    if (!commands?.recordBudgetCrossing) return;

    const budgetIds = [...new Set(rows.map((r) => r.budgetId))];
    const budgets = await deps.prisma.gatewayBudget.findMany({
      where: { id: { in: budgetIds }, archivedAt: null },
    });
    const budgetById = new Map<string, GatewayBudget>(
      budgets.map((b) => [b.id, b]),
    );
    const candidates = rows.filter((r) => budgetById.has(r.budgetId));
    if (candidates.length === 0) return;

    const orgIds = [...new Set(budgets.map((b) => b.organizationId))];
    const projects = await deps.prisma.project.findMany({
      where: { team: { organizationId: { in: orgIds } } },
      select: { id: true },
    });
    if (projects.length === 0) return;

    const now = new Date();
    const bucketBoundaries =
      await deps.prisma.gatewayBudgetBucketBoundary.findMany({
        where: { budgetId: { in: budgetIds } },
      });
    const boundaryByKey = new Map(
      bucketBoundaries.map((b) => [
        `${b.budgetId}:${b.bucketScopeId}`,
        b.periodStartedAt.getTime(),
      ]),
    );

    const targets = candidates.map((r) => {
      const budget = budgetById.get(r.budgetId)!;
      const floors = [
        budgetPeriodFloorMs(budget, now),
        boundaryByKey.get(`${r.budgetId}:${r.bucketScopeId}`),
      ].filter((n): n is number => typeof n === "number");
      return {
        budgetId: budget.id,
        scope: budget.scopeType,
        scopeId: r.bucketScopeId,
        window: budget.window,
        match: "exact" as const,
        periodFloorMs: floors.length > 0 ? Math.max(...floors) : undefined,
      };
    });
    const spends = await deps.budgetCHRepository.getSpendForTargetsAcrossTenants(
      projects.map((p) => p.id),
      targets,
      now,
    );
    const spentByBudget = new Map(spends.map((s) => [s.budgetId, s.spentUsd]));

    for (const r of candidates) {
      const budget = budgetById.get(r.budgetId)!;
      const spentUsd = Number.parseFloat(spentByBudget.get(r.budgetId) ?? "0") || 0;
      const limitUsd = Number.parseFloat(budget.limitUsd.toString()) || 0;
      if (limitUsd <= 0) continue;
      const pct = (spentUsd * 100) / limitUsd;
      let kind: BudgetCrossingKind | null = null;
      if (pct >= 100) kind = "breached";
      else if (pct >= SoftWarnPercent) kind = "threshold_crossed";
      if (!kind) continue;

      const floor = targets.find(
        (t) => t.budgetId === r.budgetId && t.scopeId === r.bucketScopeId,
      )?.periodFloorMs;
      const periodStartedAtMs =
        floor ?? currentPeriodStart(budget.window, now).getTime();

      const payload: RecordBudgetCrossingCommandData = {
        tenantId: r.tenantId,
        organization_id: budget.organizationId,
        budget_id: budget.id,
        kind,
        scope_type: budget.scopeType.toLowerCase(),
        bucket_scope_id: r.bucketScopeId,
        end_user_id: r.endUserId,
        window: budget.window,
        period_started_at_ms: periodStartedAtMs,
        limit_usd: limitUsd.toFixed(6),
        spent_usd: spentUsd.toFixed(6),
        on_breach: budget.onBreach === "BLOCK" ? "block" : "warn",
        occurred_at: Date.now(),
      };
      await commands.recordBudgetCrossing.send(payload);
    }
  } catch (error) {
    logger.warn(
      { budgets: rows.length, error },
      "budget crossing detection failed (best effort)",
    );
  }
}
