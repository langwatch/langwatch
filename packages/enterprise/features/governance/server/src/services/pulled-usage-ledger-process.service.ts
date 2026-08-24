import {
  PULLED_USAGE_EVENT_TYPES,
  type PulledUsageObservedEventData,
  type PulledUsageObservedEvent,
} from "@langwatch/enterprise-governance-contract";
import type { Event, ProcessManagerApplier } from "@langwatch/eventing";
import { z } from "zod";
import { PulledUsageLedgerPort } from "../ports/pulled-usage-ledger.port";

export const PULLED_USAGE_LEDGER_PROCESS_NAME = "pulledUsageLedger" as const;

export const writePulledUsageSchema = z.object({
  restatement_key: z.string(),
  tenant_id: z.string(),
  scope_id: z.string(),
  organization_id: z.string(),
  team_id: z.string().nullable().default(null),
  model: z.string().default(""),
  cost_nano_usd: z.number().int().min(0),
  tokens_input: z.number().int().min(0).default(0),
  tokens_output: z.number().int().min(0).default(0),
  tokens_cache_read: z.number().int().min(0).default(0),
  tokens_cache_write: z.number().int().min(0).default(0),
  occurred_at_ms: z.number().int().positive(),
  observed_at_ms: z.number().int().positive(),
});

export type WritePulledUsagePayload = z.infer<typeof writePulledUsageSchema>;
type PulledUsageEvent = PulledUsageObservedEvent & Event;

export class PulledUsageLedgerProcessService {
  private constructor(private readonly ledger: PulledUsageLedgerPort) {}

  static create(
    ledger: PulledUsageLedgerPort,
  ): PulledUsageLedgerProcessService {
    return new PulledUsageLedgerProcessService(ledger);
  }

  static scopeId(
    record: Pick<PulledUsageObservedEventData, "organizationId" | "teamId">,
  ): string {
    return record.teamId ?? record.organizationId;
  }

  async write(payload: WritePulledUsagePayload): Promise<void> {
    await this.ledger.insert([
      {
        tenantId: payload.tenant_id,
        scopeId: payload.scope_id,
        restatementKey: payload.restatement_key,
        amountNanoUsd: payload.cost_nano_usd,
        tokensInput: payload.tokens_input,
        tokensOutput: payload.tokens_output,
        tokensCacheRead: payload.tokens_cache_read,
        tokensCacheWrite: payload.tokens_cache_write,
        model: payload.model,
        occurredAt: new Date(payload.occurred_at_ms),
        observedAt: new Date(payload.observed_at_ms),
      },
    ]);
  }

  processManager(): ProcessManagerApplier<PulledUsageEvent> {
    return (process) =>
      process
        .state({})
        .intent("writePulledUsage", writePulledUsageSchema, (payload) =>
          this.write(payload),
        )
        .on(PULLED_USAGE_EVENT_TYPES.OBSERVED, (state, record, context) => ({
          state,
          intents: [
            context.intents.writePulledUsage(`pulled:${record.observedAtMs}`, {
              restatement_key: record.restatementKey,
              tenant_id: context.projectId,
              scope_id: PulledUsageLedgerProcessService.scopeId(record),
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
