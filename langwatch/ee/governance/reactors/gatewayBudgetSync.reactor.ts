// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  GatewayBudgetLedgerStatus,
  PrismaClient,
} from "@prisma/client";
import {
  GatewayBudgetClickHouseRepository,
  type BudgetDebitRow,
} from "~/server/gateway/budget.clickhouse.repository";
import type {
  ApplicableScopes,
  GatewayBudgetRepository,
} from "~/server/gateway/budget.repository";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";
import type { ReactorContext, ReactorDefinition } from "~/server/event-sourcing/reactors/reactor.types";
import type { TraceSummaryData } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:gateway-budget-sync-reactor",
);

/**
 * Idempotency is structural: each CH row is keyed by
 * (TenantId, BudgetId, GatewayRequestId) on a ReplacingMergeTree, so
 * replays collapse at merge time. The job-id dedup below only prevents
 * same-trace thrash while the tree is still fresh.
 */
export const GATEWAY_BUDGET_SYNC_DEBOUNCE_TTL_MS = 5 * 60_000;

export interface GatewayBudgetSyncReactorDeps {
  prisma: PrismaClient;
  budgetRepository: GatewayBudgetRepository;
  budgetCHRepository: GatewayBudgetClickHouseRepository;
}

/**
 * Fold completed gateway traces into per-budget ClickHouse debit rows.
 *
 * Registered on the trace_processing pipeline after the traceSummary fold.
 * Reads `langwatch.virtual_key_id` + `langwatch.gateway_request_id` off
 * the fold state attributes — stamped by the gateway's customer trace
 * bridge (services/aigateway/adapters/customertracebridge/emitter.go).
 * Traces without those attributes are skipped (not gateway traffic).
 *
 * Cost + tokens are taken from the fold state (post cost-enrichment
 * service) so this reactor trusts the authoritative platform-side
 * numbers rather than recomputing.
 *
 * See: specs/ai-gateway/_shared/contract.md §4.5
 */
export function createGatewayBudgetSyncReactor(
  deps: GatewayBudgetSyncReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "gatewayBudgetSync",
    options: {
      // Dedup per (tenant, trace) — one gateway trace = one debit burst.
      // Structural idempotency in the CH ReplacingMergeTree
      // (TenantId, BudgetId, GatewayRequestId) ORDER BY still protects us
      // if this TTL is shorter than the replay window.
      makeJobId: (payload) =>
        `gateway-budget-sync-${payload.event.tenantId}-${payload.event.aggregateId}`,
      ttl: GATEWAY_BUDGET_SYNC_DEBOUNCE_TTL_MS,
    },

    async handle(
      _event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId: projectId, foldState } = context;

      const virtualKeyId = foldState.attributes["langwatch.virtual_key_id"];
      const gatewayRequestId =
        foldState.attributes["langwatch.gateway_request_id"];

      if (!virtualKeyId || !gatewayRequestId) {
        return;
      }

      try {
        const vk = await deps.prisma.virtualKey.findUnique({
          where: { id: virtualKeyId },
          select: {
            id: true,
            projectId: true,
            principalUserId: true,
          },
        });
        if (!vk || vk.projectId !== projectId) {
          logger.warn(
            { projectId, virtualKeyId, gatewayRequestId },
            "gateway trace references unknown or cross-tenant VK — skipping fold",
          );
          return;
        }

        const project = await deps.prisma.project.findUnique({
          where: { id: projectId },
          select: {
            id: true,
            teamId: true,
            team: { select: { organizationId: true } },
          },
        });
        if (!project?.team) {
          logger.warn(
            { projectId, virtualKeyId },
            "project missing team relation — skipping gateway budget fold",
          );
          return;
        }

        const scopes: ApplicableScopes = {
          organizationId: project.team.organizationId,
          teamId: project.teamId,
          projectId: project.id,
          virtualKeyId: vk.id,
          principalUserId: vk.principalUserId,
        };
        const budgets = await deps.budgetRepository.applicableForRequest(scopes);
        if (budgets.length === 0) return;

        const amountUsd = formatDecimal(foldState.totalCost ?? 0);
        const tokensInput = foldState.totalPromptTokenCount ?? 0;
        const tokensOutput = foldState.totalCompletionTokenCount ?? 0;
        const model = foldState.models[0] ?? "unknown";
        const status: GatewayBudgetLedgerStatus = foldState.blockedByGuardrail
          ? "BLOCKED_BY_GUARDRAIL"
          : foldState.containsErrorStatus
            ? "PROVIDER_ERROR"
            : "SUCCESS";
        const occurredAt = new Date(foldState.occurredAt);

        const rows: BudgetDebitRow[] = budgets.map((b) => ({
          tenantId: projectId,
          budgetId: b.id,
          scope: b.scopeType,
          scopeId: b.scopeId,
          window: b.window,
          virtualKeyId: vk.id,
          gatewayRequestId,
          amountUsd,
          tokensInput,
          tokensOutput,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          model,
          durationMs: Math.round(foldState.totalDurationMs ?? 0),
          status,
          occurredAt,
        }));

        await deps.budgetCHRepository.insertDebit(rows);
      } catch (error) {
        logger.error(
          {
            projectId,
            virtualKeyId,
            gatewayRequestId,
            error,
          },
          "failed to fold gateway trace into CH budget ledger",
        );
        captureException(error);
      }
    },
  };
}

/**
 * Serialise a JS number to the fixed-point decimal string CH expects
 * for Decimal(18, 10). Must round at 10 dp to avoid precision overflow.
 */
function formatDecimal(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  return n.toFixed(10);
}
