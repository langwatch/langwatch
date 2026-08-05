// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import type { GatewayBudget, PrismaClient, VirtualKey } from "@prisma/client";
import { getApp } from "~/server/app-layer/app";
import type {
  BudgetCrossingKind,
  RecordBudgetCrossingCommandData,
  RecordVkLifecycleCommandData,
  VkLifecycleAction,
} from "~/server/event-sourcing/pipelines/governance-events/schemas/commands";
import { GOVERNANCE_EVENTS_PIPELINE_NAME } from "~/server/event-sourcing/pipelines/governance-events/schemas/constants";
import type {
  BudgetSpendTarget,
  GatewayBudgetClickHouseRepository,
} from "~/server/gateway/budget.clickhouse.repository";
import {
  budgetPeriodFloorMs,
  currentPeriodStart,
} from "~/server/gateway/budgetPeriod";
import { SoftWarnPercent } from "./governanceSignals.constants";

const logger = createLogger("langwatch:governance:signals");

/**
 * Emission seams for the governance webhook families. Everything here is
 * BEST EFFORT by contract: a governance signal is a notification, and no
 * mutation or debit may ever fail because its notification could not be
 * appended. The store-level idempotency keys make every retry safe.
 */

function governanceCommands(): Record<
  string,
  { send: (payload: unknown) => Promise<unknown> }
> | null {
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

export interface VkLifecycleSignal {
  vk: Pick<
    VirtualKey,
    "id" | "organizationId" | "name" | "displayPrefix" | "traceProjectId"
  >;
  action: VkLifecycleAction;
  /** Operator note carried to the webhook, when the action has one. */
  reason?: string | null;
}

export async function emitVkLifecycle(
  prisma: PrismaClient,
  signal: VkLifecycleSignal,
): Promise<void> {
  const { vk, action } = signal;
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
      reason: signal.reason ?? null,
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

export interface CrossingDetectionDeps {
  prisma: PrismaClient;
  budgetCHRepository: GatewayBudgetClickHouseRepository;
}

/**
 * What a crossing read needs out of Postgres: the live budgets behind the
 * written rows, the projects whose ledger carries their spend, and the
 * bucket boundaries that moved off the calendar.
 */
interface CrossingContext {
  candidates: CrossingCandidateRow[];
  budgetById: Map<string, GatewayBudget>;
  boundaryByKey: Map<string, number>;
  projectIds: string[];
}

/** Null when nothing is left to read: no live budget, or no project. */
async function loadCrossingContext(
  deps: CrossingDetectionDeps,
  rows: CrossingCandidateRow[],
): Promise<CrossingContext | null> {
  const budgetIds = [...new Set(rows.map((r) => r.budgetId))];
  const budgets = await deps.prisma.gatewayBudget.findMany({
    where: { id: { in: budgetIds }, archivedAt: null },
  });
  const budgetById = new Map<string, GatewayBudget>(
    budgets.map((b) => [b.id, b]),
  );
  const candidates = rows.filter((r) => budgetById.has(r.budgetId));
  if (candidates.length === 0) return null;

  const orgIds = [...new Set(budgets.map((b) => b.organizationId))];
  const projects = await deps.prisma.project.findMany({
    where: { team: { organizationId: { in: orgIds } } },
    select: { id: true },
  });
  if (projects.length === 0) return null;

  const bucketBoundaries =
    await deps.prisma.gatewayBudgetBucketBoundary.findMany({
      where: {
        organizationId: { in: orgIds },
        budgetId: { in: budgetIds },
      },
    });
  return {
    candidates,
    budgetById,
    boundaryByKey: new Map(
      bucketBoundaries.map((b) => [
        `${b.budgetId}:${b.bucketScopeId}`,
        b.periodStartedAt.getTime(),
      ]),
    ),
    projectIds: projects.map((p) => p.id),
  };
}

/**
 * One spend target per written bucket, floored at the later of the
 * budget's own period and the bucket's recorded boundary, so a bucket
 * reset mid-period never reads spend from before its reset.
 */
function buildSpendTargets(
  context: CrossingContext,
  now: Date,
): BudgetSpendTarget[] {
  return context.candidates.map((r) => {
    const budget = context.budgetById.get(r.budgetId)!;
    const floors = [
      budgetPeriodFloorMs(budget, now),
      context.boundaryByKey.get(`${r.budgetId}:${r.bucketScopeId}`),
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
}

/**
 * Breached once spend reaches the limit, threshold at the soft warn line,
 * nothing below it. A budget without a positive limit never crosses.
 */
function crossingKind(
  spentUsd: number,
  limitUsd: number,
): BudgetCrossingKind | null {
  if (limitUsd <= 0) return null;
  const pct = (spentUsd * 100) / limitUsd;
  if (pct >= 100) return "breached";
  if (pct >= SoftWarnPercent) return "threshold_crossed";
  return null;
}

/**
 * The crossing command for one written bucket, or null when the bucket has
 * not crossed. The period start is the bucket's own floor when it has one,
 * so a moved boundary opens its own crossing window.
 */
function crossingFor(options: {
  row: CrossingCandidateRow;
  budget: GatewayBudget;
  /** The bucket's ledger total, as the spend read returned it. */
  spentUsd: string | undefined;
  periodFloorMs: number | undefined;
  now: Date;
}): RecordBudgetCrossingCommandData | null {
  const { row, budget, now } = options;
  const spent = Number.parseFloat(options.spentUsd ?? "0") || 0;
  const limit = Number.parseFloat(budget.limitUsd.toString()) || 0;
  const kind = crossingKind(spent, limit);
  if (!kind) return null;

  return {
    tenantId: row.tenantId,
    organization_id: budget.organizationId,
    budget_id: budget.id,
    kind,
    scope_type: budget.scopeType.toLowerCase(),
    bucket_scope_id: row.bucketScopeId,
    end_user_id: row.endUserId,
    virtual_key_id:
      budget.scopeType === "VIRTUAL_KEY" ||
      budget.scopeType === "ATTRIBUTED_USER"
        ? budget.scopeId
        : null,
    anchor_project_id: budget.scopeType === "PROJECT" ? budget.scopeId : null,
    window: budget.window,
    period_started_at_ms:
      options.periodFloorMs ?? currentPeriodStart(budget.window, now).getTime(),
    limit_usd: limit.toFixed(6),
    spent_usd: spent.toFixed(6),
    on_breach: budget.onBreach === "BLOCK" ? "block" : "warn",
    occurred_at: Date.now(),
  };
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
  deps: CrossingDetectionDeps,
  rows: CrossingCandidateRow[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const commands = governanceCommands();
    if (!commands?.recordBudgetCrossing) return;

    // One instant anchors the whole read: the period floors, the spend
    // read and the stamped period start all have to agree.
    const now = new Date();
    const context = await loadCrossingContext(deps, rows);
    if (!context) return;

    const targets = buildSpendTargets(context, now);
    const spends =
      await deps.budgetCHRepository.getSpendForTargetsAcrossTenants(
        context.projectIds,
        targets,
        now,
      );
    const spentByBudget = new Map(spends.map((s) => [s.budgetId, s.spentUsd]));

    for (const r of context.candidates) {
      const crossing = crossingFor({
        row: r,
        budget: context.budgetById.get(r.budgetId)!,
        spentUsd: spentByBudget.get(r.budgetId),
        periodFloorMs: targets.find(
          (t) => t.budgetId === r.budgetId && t.scopeId === r.bucketScopeId,
        )?.periodFloorMs,
        now,
      });
      if (!crossing) continue;
      await commands.recordBudgetCrossing.send(crossing);
    }
  } catch (error) {
    logger.warn(
      { budgets: rows.length, error },
      "budget crossing detection failed (best effort)",
    );
  }
}
