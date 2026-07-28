// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import type {
  GatewayBudgetLedgerStatus,
  PrismaClient,
} from "@prisma/client";
import { parseGatewaySpans } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/gateway-spans.service";
import type { TraceSummaryData } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import type { ReactorContext, ReactorDefinition } from "~/server/event-sourcing/reactors/reactor.types";
import {
  type BudgetDebitRow,
  GatewayBudgetClickHouseRepository,
} from "~/server/gateway/budget.clickhouse.repository";
import type {
  ApplicableScopes,
  GatewayBudgetRepository,
} from "~/server/gateway/budget.repository";
import { budgetAppliesToProvider } from "~/server/gateway/budgetResolution.service";
import { ChangeEventRepository } from "~/server/gateway/changeEvent.repository";
import { captureException, toError } from "~/utils/posthogErrorCapture";

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
            organizationId: true,
            principalUserId: true,
            lastUsedAt: true,
          },
        });
        if (!vk) {
          logger.warn(
            { projectId, virtualKeyId, gatewayRequestId },
            "gateway trace references unknown VK — skipping fold",
          );
          return;
        }

        // EC6 — touch lastUsedAt on every gateway trace, regardless of
        // whether the VK has applicable budgets. The /budget/check
        // hook in gateway-internal.ts only fires when the gateway
        // calls it (which it skips when there are no budgets to
        // precheck), so VKs without budgets had `lastUsedAt = null`
        // forever and admin oversight ("when did this user last
        // use their personal VK") was broken on the most common case.
        //
        // 60s throttle mirrors the /budget/check fix — admin
        // dashboards refresh on minute-scale, no need to thrash the
        // row on every request.
        const now = new Date();
        const shouldTouch =
          !vk.lastUsedAt ||
          now.getTime() - vk.lastUsedAt.getTime() > 60 * 1000;
        logger.info(
          {
            projectId,
            virtualKeyId,
            previousLastUsedAt: vk.lastUsedAt,
            shouldTouch,
          },
          "EC6 lastUsedAt touch decision",
        );
        if (shouldTouch) {
          try {
            // Post-collapse VirtualKey is org-scoped in SCOPED_MODELS; the
            // dbMTP guard accepts a row id as tenancy proof for single-row
            // writes, so the bare id-only where clause is valid.
            await deps.prisma.virtualKey.update({
              where: { id: vk.id },
              data: { lastUsedAt: now },
            });
            logger.info(
              { projectId, virtualKeyId, touchedAt: now.toISOString() },
              "EC6 lastUsedAt touched",
            );
          } catch (touchErr) {
            // Best-effort: a row update failure here doesn't poison
            // the budget fold below, and the /budget/check hook is
            // a fallback for the budgeted-VK case.
            logger.warn(
              { projectId, virtualKeyId, error: touchErr },
              "failed to touch virtualKey.lastUsedAt during gateway trace fold",
            );
          }
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
        // Cross-tenant guard: post-collapse VKs carry organizationId only;
        // the trace's tenant project must live under the same org.
        if (project.team.organizationId !== vk.organizationId) {
          logger.warn(
            { projectId, virtualKeyId, gatewayRequestId },
            "gateway trace references cross-tenant VK — skipping fold",
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
        // The provider the gateway actually dispatched to. Absent on
        // gateways that predate the field, in which case only unfiltered
        // budgets accrue: attributing an unknown dispatch to a provider-
        // filtered budget would be a guess, and a guess here silently
        // mis-bills a governance control.
        const dispatchedProviderKey =
          foldState.attributes["langwatch.model_provider_id"] ?? null;

        const resolved = await deps.budgetRepository.resolveForRequest(scopes);
        if (resolved.length === 0) return;

        // Per-REQUEST grain: the fold keeps one bookkeeping entry per gateway
        // span (reserved attribute, survives the trace_summaries round-trip),
        // so N calls folded under one client traceparent debit as N requests,
        // each with its own id, cost, token classes and provider. Provider
        // filtering runs per entry for the same reason: two requests under
        // one traceparent can dispatch to different providers, and a
        // provider-filtered budget must accrue exactly the requests that
        // went to its provider. Traces folded before the entry list existed
        // carry only the first-wins attributes; those fall back to the old
        // whole-trace single row so a rolling deploy never drops debits.
        const entries = parseGatewaySpans(foldState.attributes);
        let rows: BudgetDebitRow[];
        if (entries.length > 0) {
          rows = entries.flatMap((entry) => {
            const entryProviderKey = entry.modelProviderId || null;
            return resolved
              .filter((r) =>
                budgetAppliesToProvider(r.budget, entryProviderKey),
              )
              .map(({ budget: b, bucketScopeId }) => ({
                tenantId: projectId,
                budgetId: b.id,
                scope: b.scopeType,
                scopeId: bucketScopeId,
                window: b.window,
                virtualKeyId: entry.virtualKeyId,
                providerKey: entryProviderKey,
                gatewayRequestId: entry.requestId,
                amountUsd: formatDecimal(entry.costUsd),
                tokensInput: entry.inputTokens,
                tokensOutput: entry.outputTokens,
                tokensCacheRead: entry.cacheReadTokens,
                tokensCacheWrite: entry.cacheWriteTokens,
                model: entry.model,
                durationMs: entry.durationMs,
                status: foldState.blockedByGuardrail
                  ? ("BLOCKED_BY_GUARDRAIL" as const)
                  : entry.status === "error"
                    ? ("PROVIDER_ERROR" as const)
                    : ("SUCCESS" as const),
                occurredAt: new Date(entry.occurredAtMs),
              }));
          });
        } else {
          const budgets = resolved.filter((r) =>
            budgetAppliesToProvider(r.budget, dispatchedProviderKey),
          );
          const amountUsd = formatDecimal(foldState.totalCost ?? 0);
          const status: GatewayBudgetLedgerStatus = foldState.blockedByGuardrail
            ? "BLOCKED_BY_GUARDRAIL"
            : foldState.containsErrorStatus
              ? "PROVIDER_ERROR"
              : "SUCCESS";
          rows = budgets.map(({ budget: b, bucketScopeId }) => ({
            tenantId: projectId,
            budgetId: b.id,
            scope: b.scopeType,
            scopeId: bucketScopeId,
            window: b.window,
            virtualKeyId: vk.id,
            providerKey: dispatchedProviderKey,
            gatewayRequestId,
            amountUsd,
            tokensInput: foldState.totalPromptTokenCount ?? 0,
            tokensOutput: foldState.totalCompletionTokenCount ?? 0,
            tokensCacheRead: 0,
            tokensCacheWrite: 0,
            model: foldState.models[0] ?? "unknown",
            durationMs: Math.round(foldState.totalDurationMs ?? 0),
            status,
            occurredAt: new Date(foldState.occurredAt),
          }));
        }
        if (rows.length === 0) return;

        await deps.budgetCHRepository.insertDebits(rows);

        // Change-event payload: budgets that actually accrued, and the
        // debited total summed once per request (row fan-out across budgets
        // must not multiply it).
        const debitedBudgetIds = [...new Set(rows.map((r) => r.budgetId))];
        const amountByRequest = new Map(
          rows.map((r) => [r.gatewayRequestId, Number(r.amountUsd)]),
        );
        const amountUsd = formatDecimal(
          [...amountByRequest.values()].reduce((sum, n) => sum + n, 0),
        );

        // EC4 — emit a BUDGET_UPDATED change event so the gateway's
        // /changes subscriber (services/aigateway/adapters/authresolver)
        // evicts cached bundles for this project and the next request
        // re-resolves with fresh spend. Without this, Bundle.Config.
        // Budget.SpentMicroUSD stays frozen at populateConfig time and
        // the on-breach=block precheck never fires until the JWT TTL
        // (~15min) rolls.
        //
        // v2 TODO: dedupe — emit at most once per (projectId, budgetId)
        // per ~10s window to avoid every gateway request triggering an
        // L1 sweep + cold-miss on every other VK in the project. For
        // current dogfood / single-tenant scale the unconditional emit
        // is correct (just noisier than ideal).
        try {
          const changeEvents = new ChangeEventRepository(deps.prisma);
          await changeEvents.append({
            organizationId: project.team.organizationId,
            projectId,
            kind: "BUDGET_UPDATED",
            payload: {
              gatewayRequestId,
              virtualKeyId: vk.id,
              budgetIds: debitedBudgetIds,
              amountUsd,
            },
          });
        } catch (changeErr) {
          // Best-effort. The CH ledger row already landed; failing the
          // change event would just leave the gateway's cache slightly
          // staler than it could be, not corrupt any state.
          logger.warn(
            { projectId, virtualKeyId, gatewayRequestId, error: changeErr },
            "failed to emit BUDGET_UPDATED change event after fold",
          );
        }
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
        captureException(toError(error));
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
