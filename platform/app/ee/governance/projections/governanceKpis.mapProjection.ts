// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `governance_kpis` as a derived-state map (ADR-107 decision 17, pre-built).
 * One row per governance span contribution, keyed by
 * `(TenantId, SourceId, HourBucket, TraceId, EventId)` where `EventId` is the
 * span id — idempotent under replay because the version column is the span
 * event's own `occurredAt`. Readers `sum(SpendUsd)` at read time.
 */

import type { GovernanceKpiContribution } from "@ee/governance/services/governanceKpis.clickhouse.repository";
import type {
  AppendStore,
  BuiltMap,
  WireEvent,
} from "@langwatch/event-sourcing";
import type { CanonicalSpan } from "~/server/event-sourcing/trace-processing/schema";
import { readGovernanceSpanFacts } from "./governanceSpanFacts";

const HOUR_MS = 60 * 60 * 1000;

export function toStartOfHour(unixMs: number): Date {
  return new Date(Math.floor(unixMs / HOUR_MS) * HOUR_MS);
}

/** PURE and TOTAL: a rebuild has to reproduce the live row exactly. */
export function deriveGovernanceKpiContribution({
  tenantId,
  span,
  occurredAtMs,
}: {
  tenantId: string;
  span: CanonicalSpan;
  occurredAtMs: number;
}): GovernanceKpiContribution | null {
  const facts = readGovernanceSpanFacts(span);
  if (!facts) return null;

  const version =
    Number.isFinite(occurredAtMs) && occurredAtMs > 0
      ? occurredAtMs
      : facts.eventTimeMs;

  return {
    tenantId,
    sourceId: facts.sourceId,
    sourceType: facts.sourceType,
    hourBucket: toStartOfHour(facts.eventTimeMs),
    traceId: facts.traceId,
    eventId: facts.eventId,
    spendUsd: span.cost.cost ?? 0,
    promptTokens: span.usage.inputTokens ?? 0,
    completionTokens: span.usage.outputTokens ?? 0,
    lastEventOccurredAt: new Date(version),
  };
}

export function createGovernanceKpisMap(deps: {
  store: AppendStore<GovernanceKpiContribution>;
}): BuiltMap {
  return {
    name: "governanceKpis",
    eventTypes: ["lw.obs.trace.span_received"],
    async apply(delivery) {
      const records: GovernanceKpiContribution[] = [];
      for (const event of delivery.events as readonly WireEvent[]) {
        const span = event.data as CanonicalSpan;
        const record = deriveGovernanceKpiContribution({
          tenantId: span.tenantId,
          span,
          occurredAtMs: span.occurredAt,
        });
        if (record) records.push(record);
      }
      if (records.length === 0) return { written: 0 };
      await deps.store.writeBatch(records, {
        tenantId: delivery.tenantId,
        retentionDays: delivery.retentionDays,
      });
      return { written: records.length };
    },
  };
}
