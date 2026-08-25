import {
  PULLED_USAGE_EVENT_TYPES,
  type PulledUsageObservedEventData,
  type PulledUsageObservedEvent,
} from "@langwatch/enterprise-governance-contract";
import type { Event, ProcessManagerApplier } from "@langwatch/eventing";
import {
  PulledUsageLedgerIntent,
  writePulledUsageSchema,
} from "../intents/pulled-usage-ledger.intent";
import { PulledUsageLedgerPort } from "../ports/pulled-usage-ledger.port";

export const PULLED_USAGE_LEDGER_PROCESS_NAME = "pulledUsageLedger" as const;

type PulledUsageEvent = PulledUsageObservedEvent & Event;

export class PulledUsageLedgerProcess {
  private constructor(private readonly intent: PulledUsageLedgerIntent) {}

  static create(ledger: PulledUsageLedgerPort): PulledUsageLedgerProcess {
    return new PulledUsageLedgerProcess(PulledUsageLedgerIntent.create(ledger));
  }

  static scopeId(
    record: Pick<PulledUsageObservedEventData, "organizationId" | "teamId">,
  ): string {
    return record.teamId ?? record.organizationId;
  }

  processManager(): ProcessManagerApplier<PulledUsageEvent> {
    return (process) =>
      process
        .state({})
        .intent("writePulledUsage", writePulledUsageSchema, (payload) =>
          this.intent.execute(payload),
        )
        .on(PULLED_USAGE_EVENT_TYPES.OBSERVED, (state, record, context) => ({
          state,
          intents: [
            context.intents.writePulledUsage(`pulled:${record.observedAtMs}`, {
              restatement_key: record.restatementKey,
              tenant_id: context.projectId,
              scope_id: PulledUsageLedgerProcess.scopeId(record),
              organization_id: record.organizationId,
              team_id: record.teamId,
              model: record.model,
              cost_nano_usd: record.costNanoUsd,
              tokens_input: record.tokensInput,
              tokens_output: record.tokensOutput,
              tokens_cache_read: record.tokensCacheRead,
              tokens_cache_write: record.tokensCacheWrite,
              occurred_at_ms: record.occurredAtMs,
              observed_at_ms: record.observedAtMs,
            }),
          ],
        }))
        .outbox({
          maxAttempts: 8,
          concurrency: 4,
          batchSize: 8,
          leaseDurationMs: 120_000,
        });
  }
}
