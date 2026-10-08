import type { PulledUsagePricedEventData } from "@langwatch/enterprise-governance-contract";
import { z } from "zod";

import type { RetractCommandEnvelope } from "./pulled-usage-retraction.intent.ts";

export const writePulledUsageSchema = z.object({
  restatement_key: z.string(),
  tenant_id: z.string(),
  scope_id: z.string(),
  organization_id: z.string(),
  team_id: z.string().nullable().default(null),
  model: z.string().default(""),
  /**
   * Item's worth in the ledger's dollars (decided by process; see ledgerAmountNanoUsd).
   * Not nullable: unanswerable items never reach here. Signed to handle provider credits.
   */
  cost_nano_usd: z.number().int(),
  tokens_input: z.number().int().min(0).default(0),
  tokens_output: z.number().int().min(0).default(0),
  tokens_cache_read: z.number().int().min(0).default(0),
  tokens_cache_write: z.number().int().min(0).default(0),
  occurred_at_ms: z.number().int().positive(),
  observed_at_ms: z.number().int().positive(),
});

type WritePulledUsagePayload = z.infer<typeof writePulledUsageSchema>;

/** Where a priced observation goes: governance's own `recordPulledUsagePriced` command. */
export interface PulledUsagePricingDeps {
  sendRecordPulledUsagePriced: (
    data: PulledUsagePricedEventData & RetractCommandEnvelope,
  ) => Promise<void>;
}

/** Records the priced fact; gateway's ledger subscribes and debits it (Q208C, Alex 2026-10-06). */
export class PulledUsageLedgerIntent {
  private constructor(private readonly deps: PulledUsagePricingDeps) {}

  static create(deps: PulledUsagePricingDeps): PulledUsageLedgerIntent {
    return new PulledUsageLedgerIntent(deps);
  }

  async execute(payload: WritePulledUsagePayload): Promise<void> {
    await this.deps.sendRecordPulledUsagePriced({
      tenantId: payload.tenant_id,
      occurredAt: payload.occurred_at_ms,
      restatementKey: payload.restatement_key,
      organizationId: payload.organization_id,
      teamId: payload.team_id,
      scopeId: payload.scope_id,
      model: payload.model,
      amountNanoUsd: payload.cost_nano_usd,
      tokensInput: payload.tokens_input,
      tokensOutput: payload.tokens_output,
      tokensCacheRead: payload.tokens_cache_read,
      tokensCacheWrite: payload.tokens_cache_write,
      occurredAtMs: payload.occurred_at_ms,
      observedAtMs: payload.observed_at_ms,
    });
  }
}
