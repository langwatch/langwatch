import { z } from "zod";
import { PulledUsageLedgerPort } from "../ports/pulled-usage-ledger.port";

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

export class PulledUsageLedgerIntent {
  private constructor(private readonly ledger: PulledUsageLedgerPort) {}

  static create(ledger: PulledUsageLedgerPort): PulledUsageLedgerIntent {
    return new PulledUsageLedgerIntent(ledger);
  }

  async execute(payload: WritePulledUsagePayload): Promise<void> {
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
}
