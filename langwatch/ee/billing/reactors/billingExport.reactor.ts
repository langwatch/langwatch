// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import { Counter, register } from "prom-client";
import {
  type GatewaySpanEntry,
  parseGatewaySpans,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/services/gateway-spans.service";
import type { TraceSummaryData } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import type {
  ReactorContext,
  ReactorDefinition,
} from "~/server/event-sourcing/reactors/reactor.types";
import type {
  GatewaySpendEventsRepository,
  SpendEventRow,
} from "~/server/gateway/spendEvents.clickhouse.repository";
import { parseJsonStringArray } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-summary.utils";
import { captureException, toError } from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:billing:billing-export-reactor");

/**
 * Written-rows counter: the emitted side of the billing completeness
 * watermark (folded gateway spans vs written spend rows). A widening gap
 * between this and the fold's gateway-span throughput is data loss and
 * must page someone, not surface at invoice time.
 */
const spendEventsWritten =
  (register.getSingleMetric(
    "billing_spend_events_written_total",
  ) as Counter<string>) ??
  new Counter({
    name: "billing_spend_events_written_total",
    help: "Gateway spend event rows written by the billingExport reactor",
  });

export const BILLING_EXPORT_DEBOUNCE_TTL_MS = 5 * 60_000;

export interface BillingExportReactorDeps {
  prisma: PrismaClient;
  spendEventsRepository: GatewaySpendEventsRepository;
}

/**
 * Fold completed gateway traces into UNCONDITIONAL per-request spend rows.
 *
 * The budget-sync reactor next door writes enforcement debits and is
 * correctly budget-gated; this one is the billing record and never gates:
 * a key with zero budgets still meters. One row per gateway span entry on
 * the fold (per-request grain); traces folded before the entry list
 * existed fall back to one whole-trace row so a rolling deploy never
 * drops spend.
 *
 * Deliberately NOT copied from the sibling reactor: the unconditional
 * per-trace change-event emit and the hot-path lastUsedAt write with info
 * logs. This reactor does one thing.
 */
export function createBillingExportReactor(
  deps: BillingExportReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "billingExport",
    options: {
      makeJobId: (payload) =>
        `billing-export-${payload.event.tenantId}-${payload.event.aggregateId}`,
      ttl: BILLING_EXPORT_DEBOUNCE_TTL_MS,
    },

    async handle(
      _event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId: projectId, foldState } = context;

      const firstWinsVk = foldState.attributes["langwatch.virtual_key_id"];
      const firstWinsRequestId =
        foldState.attributes["langwatch.gateway_request_id"];
      if (!firstWinsVk || !firstWinsRequestId) return; // not gateway traffic

      try {
        const entries = parseGatewaySpans(foldState.attributes);
        const virtualKeyIds = [
          ...new Set(
            entries.length > 0
              ? entries.map((e) => e.virtualKeyId)
              : [firstWinsVk],
          ),
        ];

        // All entries on one trace come from one key in practice; resolve
        // each id defensively anyway so a mixed trace cannot mis-attribute.
        const vks = await deps.prisma.virtualKey.findMany({
          where: { id: { in: virtualKeyIds } },
          select: { id: true, organizationId: true, principalUserId: true },
        });
        const vkById = new Map(vks.map((vk) => [vk.id, vk]));

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
            { projectId },
            "project missing team relation, skipping spend export",
          );
          return;
        }

        const labels = parseJsonStringArray(
          foldState.attributes["langwatch.labels"],
        );
        const traceId = foldState.traceId || String(context.aggregateId);

        const toRow = (entry: GatewaySpanEntry): SpendEventRow | null => {
          const vk = vkById.get(entry.virtualKeyId);
          if (!vk) {
            logger.warn(
              { projectId, virtualKeyId: entry.virtualKeyId },
              "spend entry references unknown VK, skipping row",
            );
            return null;
          }
          // Cross-tenant guard, same rule the budget reactor enforces.
          if (vk.organizationId !== project.team!.organizationId) {
            logger.warn(
              { projectId, virtualKeyId: vk.id },
              "spend entry references cross-tenant VK, skipping row",
            );
            return null;
          }
          return {
            tenantId: projectId,
            gatewayRequestId: entry.requestId,
            organizationId: vk.organizationId,
            teamId: project.teamId,
            virtualKeyId: vk.id,
            principalUserId: vk.principalUserId ?? "",
            endUserId: entry.endUserId,
            traceId,
            model: entry.model,
            providerKey: entry.modelProviderId,
            tokensInput: entry.inputTokens,
            tokensOutput: entry.outputTokens,
            tokensCacheRead: entry.cacheReadTokens,
            tokensCacheWrite: entry.cacheWriteTokens,
            tokensReasoning: entry.reasoningTokens,
            costUsd: formatDecimal(entry.costUsd),
            status: entry.status,
            errorClass: entry.errorClass,
            httpStatus: entry.httpStatus,
            labels,
            metadata: "",
            durationMs: entry.durationMs,
            occurredAt: new Date(entry.occurredAtMs),
          };
        };

        const rows =
          entries.length > 0
            ? entries
                .map(toRow)
                .filter((r): r is SpendEventRow => r !== null)
            : [
                toRow({
                  // Legacy fold state (pre-entry-list): one whole-trace row
                  // under the first request's id, mirroring what the ledger
                  // recorded for those traces.
                  requestId: firstWinsRequestId,
                  virtualKeyId: firstWinsVk,
                  model: foldState.models[0] ?? "unknown",
                  modelProviderId: foldState.attributes["langwatch.model_provider_id"] ?? "",
                  inputTokens: foldState.totalPromptTokenCount ?? 0,
                  outputTokens: foldState.totalCompletionTokenCount ?? 0,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                  reasoningTokens: 0,
                  costUsd: foldState.totalCost ?? 0,
                  status: foldState.containsErrorStatus ? "error" : "success",
                  errorClass: "",
                  httpStatus: 0,
                  endUserId: "",
                  occurredAtMs: foldState.occurredAt,
                  durationMs: Math.round(foldState.totalDurationMs ?? 0),
                }),
              ].filter((r): r is SpendEventRow => r !== null);

        if (rows.length === 0) return;
        const written =
          await deps.spendEventsRepository.insertSpendEvents(rows);
        if (written > 0) spendEventsWritten.inc(written);
      } catch (error) {
        logger.error(
          { projectId, error },
          "failed to export gateway spend events",
        );
        captureException(toError(error));
        // Rethrow so the reactor's at-least-once retry gets another shot;
        // spend rows lost here are billing rows lost.
        throw error;
      }
    },
  };
}

/** Fixed-point string for CH Decimal(18,6). */
function formatDecimal(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  return n.toFixed(6);
}
