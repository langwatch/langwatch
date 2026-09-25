import {
  PULLED_USAGE_DEFAULT_CURRENCY_CODE,
  PULLED_USAGE_EVENT_TYPES,
  type PulledUsageObservedEventData,
  type PulledUsageObservedEvent,
  type PulledUsageRetractedEvent,
} from "@langwatch/enterprise-governance-contract";
import type { Event, ProcessManagerApplier } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";

import { type PulledUsageLedgerRepository } from "../app/governance.members.ts";
import {
  type FiledCell,
  filedCellFor,
  isReissuedElsewhere,
} from "../rules/pulled-usage-reissue.rules.ts";
import { PulledUsageLedgerIntent, writePulledUsageSchema } from "./pulled-usage-ledger.intent.ts";
import {
  type PulledUsageRetractionDeps,
  PulledUsageRetractionIntent,
  retractPulledUsageSchema,
} from "./pulled-usage-retraction.intent.ts";

const logger = createLogger("langwatch:governance:pulled-usage-ledger");

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

/**
 * The one thing remembered per charge: the cell it was last filed in. Not rebuildable from
 * the log; losing it fails towards a missed withdrawal, never a wrong one (main
 * `pulledUsageLedger.process.ts`).
 */
export interface PulledUsageLedgerState {
  filedCell: FiledCell | null;
}

const INITIAL_PULLED_USAGE_LEDGER_STATE: PulledUsageLedgerState = { filedCell: null };

type PulledUsageEvent = (PulledUsageObservedEvent | PulledUsageRetractedEvent) & Event;

/**
 * The sole writer of pulled cost into the usage ledger, one instance per restatement key:
 * the one place the cell a charge sits in and the cell its next pull lands in meet (ADR-088).
 */
export class PulledUsageLedgerProcess {
  private constructor(
    private readonly write: PulledUsageLedgerIntent,
    private readonly retract: PulledUsageRetractionIntent,
  ) {}

  static create({
    ledger,
    retraction,
  }: {
    ledger: PulledUsageLedgerRepository;
    retraction: PulledUsageRetractionDeps;
  }): PulledUsageLedgerProcess {
    return new PulledUsageLedgerProcess(
      PulledUsageLedgerIntent.create(ledger),
      PulledUsageRetractionIntent.create(retraction),
    );
  }

  static scopeId(record: Pick<PulledUsageObservedEventData, "organizationId" | "teamId">): string {
    return record.teamId ?? record.organizationId;
  }

  processManager(): ProcessManagerApplier<PulledUsageEvent> {
    return (process) =>
      process
        .state<PulledUsageLedgerState>(INITIAL_PULLED_USAGE_LEDGER_STATE)
        .intent("writePulledUsage", writePulledUsageSchema, (payload) =>
          this.write.execute(payload),
        )
        .intent("retractPulledUsage", retractPulledUsageSchema, (payload) =>
          this.retract.execute(payload),
        )
        .on(PULLED_USAGE_EVENT_TYPES.OBSERVED, (state, record, context) => {
          // Detection precedes the unpriced return: a bill re-denominated into a currency
          // the ledger holds no dollar figure for is the headline reissue. `?? null` reads
          // a `{}` stored by the build that kept no state as a first observation.
          const filed = state.filedCell ?? null;
          const intents =
            filed !== null && isReissuedElsewhere(filed, record)
              ? [
                  context.intents.retractPulledUsage(`retract:${record.observedAtMs}`, {
                    restatement_key: record.restatementKey,
                    tenant_id: context.projectId,
                    organization_id: record.organizationId,
                    source: record.source,
                    ingestion_source_id: record.ingestionSourceId,
                    model: filed.model,
                    currency_code: filed.currencyCode,
                    agent_id: filed.agentId,
                    raw_actor_id: filed.rawActorId,
                    occurred_at_ms: filed.occurredAtMs,
                    observed_at_ms: record.observedAtMs,
                  }),
                ]
              : [];
          const nextState: PulledUsageLedgerState = { filedCell: filedCellFor(record) };

          const costNanoUsd = deriveLedgerAmountNanoUsd(record);
          // The ledger column is nano-DOLLARS; an unconverted foreign-currency
          // item has no honest value for it, so it gets no ledger row — the
          // daily cost rollup is where that money is read instead (ADR-128 §3).
          if (costNanoUsd === null) {
            logger.warn(
              {
                restatementKey: record.restatementKey,
                source: record.source,
                currencyCode: record.currencyCode,
              },
              "pulled usage is in a currency the biller published no dollar figure for; it is summarized but not written to the dollar ledger",
            );
            return { state: nextState, intents };
          }

          return {
            state: nextState,
            intents: [
              ...intents,
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
