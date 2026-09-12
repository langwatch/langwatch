import {
  PULLED_USAGE_DEFAULT_CURRENCY_CODE,
  PULLED_USAGE_EVENT_TYPES,
  type PulledUsageObservedEventData,
  type PulledUsageObservedEvent,
} from "@langwatch/enterprise-governance-contract";
import type { Event, ProcessManagerApplier } from "@langwatch/eventing";
import {
  PulledUsageLedgerIntent,
  writePulledUsageSchema,
} from "../intents/pulled-usage-ledger.intent.ts";
import { PulledUsageLedgerRepository } from "../app/governance.members.ts";

/**
 * What this item is worth in the ledger's dollars, or null when nobody can say.
 *
 * An item billed in dollars needs no conversion — the amount IS the dollar
 * amount. An item billed in anything else can only be stated in dollars by the
 * biller, and we never invent a rate to stand in for one it did not publish.
 */
function ledgerAmountNanoUsd(record: PulledUsageObservedEventData): number | null {
  if (record.currencyCode === PULLED_USAGE_DEFAULT_CURRENCY_CODE) {
    return record.costNanoMinor;
  }
  return record.costNanoUsd;
}

export const PULLED_USAGE_LEDGER_PROCESS_NAME = "pulledUsageLedger" as const;

type PulledUsageEvent = PulledUsageObservedEvent & Event;

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
          const costNanoUsd = ledgerAmountNanoUsd(record);
          // The ledger column is nano-DOLLARS. An item billed in another
          // currency that the biller published no conversion for has no honest
          // value to put in it: writing the native figure would file euros as
          // dollars, and writing 0 would report real spend as free. It gets no
          // ledger row, and the daily cost rollup — which keys by currency and
          // keeps the full amount — is where that money is read (ADR-128 §3).
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
