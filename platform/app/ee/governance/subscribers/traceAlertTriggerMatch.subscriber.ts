// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { BuiltSubscriber } from "@langwatch/event-sourcing";
import { NOTIFY_TRIGGER_ACTIONS } from "~/server/app-layer/automations/dispatch/triggerActionDispatch";
import type { TriggerService } from "~/server/app-layer/automations/trigger.service";
import { classifyTriggerFilters } from "~/server/filters/triggerFilter.matcher";

const STALE_TRACE_THRESHOLD_MS = 60 * 60 * 1000;
const MAX_TRACE_AGE_MS = 24 * 60 * 60 * 1000;

export const TRACE_ALERT_TRIGGER_MATCH_DELAY_MS = 30_000;

/** The trace facts this subscriber's own guards need — a narrow view of
 * whatever richer summary the composition root reads back. */
export interface TraceSummaryForTriggerMatch {
  readonly occurredAt: number;
  readonly blockedByGuardrail: boolean;
  readonly computedOutput: string | null;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface TraceAlertTriggerMatchDeps {
  triggers: Pick<TriggerService, "getActiveTraceTriggersForProject">;
  recordTriggerMatch: {
    send(data: {
      tenantId: string;
      occurredAt: number;
      triggerId: string;
      traceId: string;
      action: string;
      actionClass: "notify" | "persist";
      traceDebounceMs: number;
      notificationCadence: string;
    }): Promise<void>;
  };
  readTraceSummary: (params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
  }) => Promise<TraceSummaryForTriggerMatch | null>;
}

function passesOriginGuards(
  summary: TraceSummaryForTriggerMatch,
  occurredAt: number,
): boolean {
  if (occurredAt < Date.now() - STALE_TRACE_THRESHOLD_MS) return false;
  if (
    summary.occurredAt > 0 &&
    summary.occurredAt < Date.now() - MAX_TRACE_AGE_MS
  ) {
    return false;
  }
  if (summary.blockedByGuardrail && !summary.computedOutput) return false;
  return Boolean(summary.attributes["langwatch.origin"]);
}

async function recordMatches(
  deps: TraceAlertTriggerMatchDeps,
  args: { tenantId: string; traceId: string; occurredAt: number },
): Promise<void> {
  const { tenantId, traceId, occurredAt } = args;
  const triggers =
    await deps.triggers.getActiveTraceTriggersForProject(tenantId);
  for (const trigger of triggers) {
    if (classifyTriggerFilters(trigger.filters).hasEvaluationFilters) continue;
    await deps.recordTriggerMatch.send({
      tenantId,
      occurredAt,
      triggerId: trigger.id,
      traceId,
      action: trigger.action,
      actionClass: NOTIFY_TRIGGER_ACTIONS.has(trigger.action)
        ? "notify"
        : "persist",
      traceDebounceMs: trigger.traceDebounceMs,
      notificationCadence: trigger.notificationCadence,
    });
  }
}

/**
 * Matches a trace against the project's trace-scoped automations (ADR-107
 * decision 17, pre-built subscriber — `graphAlertSweep`'s real-time sibling
 * for evaluation-filtered triggers is `automations/subscribers.ts`'s
 * `triggerMatch`, mounted on evaluation-processing instead).
 *
 * **A trace whose summary cannot be read throws** — "we could not find out",
 * not "this matches nothing" — so the runtime retries rather than dropping
 * the trace's alerts permanently.
 */
export function createTraceAlertTriggerMatchSubscriber(
  deps: TraceAlertTriggerMatchDeps,
): BuiltSubscriber {
  return {
    name: "traceAlertTriggerMatch",
    eventTypes: ["lw.obs.trace.span_received", "lw.obs.trace.origin_resolved"],
    async handle(event, ctx) {
      const traceId = (event.data as { traceId: string }).traceId;
      const occurredAt =
        event.type === "lw.obs.trace.origin_resolved"
          ? ctx.now
          : (event.data as { occurredAt: number }).occurredAt;
      if (!traceId) return;

      const summary = await deps.readTraceSummary({
        tenantId: ctx.tenantId,
        traceId,
        occurredAtMs: occurredAt,
      });
      if (!summary) {
        throw new Error(
          `Trace summary not found for trace-alert trigger match (trace ${traceId})`,
        );
      }
      if (!passesOriginGuards(summary, occurredAt)) return;

      await recordMatches(deps, {
        tenantId: ctx.tenantId,
        traceId,
        occurredAt,
      });
    },
  };
}
