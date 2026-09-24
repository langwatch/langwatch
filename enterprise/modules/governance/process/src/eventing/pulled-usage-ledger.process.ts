import {
  PULLED_USAGE_DEFAULT_CURRENCY_CODE,
  PULLED_USAGE_EVENT_TYPES,
  type PulledUsageObservedEventData,
  type PulledUsageObservedEvent,
  type PulledUsageRetractedEvent,
} from "@langwatch/enterprise-governance-contract";
import type { Event, ProcessManagerApplier } from "@langwatch/eventing";

import { type PulledUsageLedgerRepository } from "../app/governance.members.ts";
import { PulledUsageLedgerIntent, writePulledUsageSchema } from "./pulled-usage-ledger.intent.ts";

/**
 * What this item is worth in the ledger's dollars, or null when nobody can
 * say. An item billed in dollars needs no conversion; anything else can only
 * be stated in dollars by the biller — we never invent a rate it didn't publish.
 */
function deriveLedgerAmountNanoUsd(record: PulledUsageObservedEventData): number | null {
  if (record.currencyCode === PULLED_USAGE_DEFAULT_CURRENCY_CODE) {
    return record.costNanoMinor;
  }
  return record.costNanoUsd;
}

export const PULLED_USAGE_LEDGER_PROCESS_NAME = "pulledUsageLedger" as const;

type PulledUsageEvent = (PulledUsageObservedEvent | PulledUsageRetractedEvent) & Event;

export class PulledUsageLedgerProcess {
  private constructor(private readonly intent: PulledUsageLedgerIntent) {}

  static create(ledger: PulledUsageLedgerRepository): PulledUsageLedgerProcess {
    return new PulledUsageLedgerProcess(PulledUsageLedgerIntent.create(ledger));
  }

  static scopeId(record: Pick<PulledUsageObservedEventData, "organizationId" | "teamId">): string {
    return record.teamId ?? record.organizationId;
  }

  processManager(): ProcessManagerApplier<PulledUsageEvent> {
    return (process) =>
      process
        .state({})
        .intent("writePulledUsage", writePulledUsageSchema, (payload) =>
          this.intent.execute(payload),
        )
        .on(PULLED_USAGE_EVENT_TYPES.OBSERVED, (state, record, context) => {
          const costNanoUsd = deriveLedgerAmountNanoUsd(record);
          // The ledger column is nano-DOLLARS; an unconverted foreign-currency
          // item has no honest value for it, so it gets no ledger row — the
          // daily cost rollup is where that money is read instead (ADR-128 §3).
          if (costNanoUsd === null) {
            return { state, intents: [] };
          }

          return {
            state,
            intents: [
              context.intents.writePulledUsage(`pulled:${record.observedAtMs}`, {
                restatement_key: record.restatementKey,
                tenant_id: context.projectId,
                scope_id: PulledUsageLedgerProcess.scopeId(record),
                organization_id: record.organizationId,
                team_id: record.teamId,
                model: record.model,
                cost_nano_usd: costNanoUsd,
                tokens_input: record.tokensInput,
                tokens_output: record.tokensOutput,
                tokens_cache_read: record.tokensCacheRead,
                tokens_cache_write: record.tokensCacheWrite,
                occurred_at_ms: record.occurredAtMs,
                observed_at_ms: record.observedAtMs,
              }),
            ],
          };
        })
        .outbox({
          maxAttempts: 8,
          concurrency: 4,
          batchSize: 8,
          leaseDurationMs: 120_000,
        });
  }
}
