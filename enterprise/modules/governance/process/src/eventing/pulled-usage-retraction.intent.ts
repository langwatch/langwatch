// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { PulledUsageRetractedEventData } from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:governance:pulled-usage-ledger");

/**
 * The SUPERSEDED cell's address, as a durable outbox row: every field a previous build may have
 * omitted carries a default. `model` rides along uncompared - it is part of the address, not a reissue.
 */
export const retractPulledUsageSchema = z.object({
  restatement_key: z.string(),
  tenant_id: z.string(),
  organization_id: z.string(),
  source: z.string(),
  ingestion_source_id: z.string(),
  model: z.string().default(""),
  currency_code: z.string().default("USD"),
  agent_id: z.string().default(""),
  raw_actor_id: z.string().default(""),
  /** The day this CORRECTS, never the day the correction arrived. */
  occurred_at_ms: z.number().int().positive(),
  /** When the superseding pull happened. The ordering field. */
  observed_at_ms: z.number().int().positive(),
});

export type RetractPulledUsagePayload = z.infer<typeof retractPulledUsageSchema>;

/** The envelope every command payload carries; a withdrawal without it fails validation at send. */
export type RetractCommandEnvelope = {
  tenantId: string;
  occurredAt: number;
};

export interface PulledUsageRetractionDeps {
  sendRetractPulledUsage: (
    data: PulledUsageRetractedEventData & RetractCommandEnvelope,
  ) => Promise<void>;
  /** Read at emit time, per organization, so switching it off stops withdrawals at once. */
  retractionEnabled: (organizationId: string) => Promise<boolean>;
}

/**
 * Withdraws the superseded version behind the outbox lease. `costNanoMinor` is a stated zero: the
 * read path falls back to `costNanoUsd` when it is absent and would empty the dollar cell instead.
 */
export class PulledUsageRetractionIntent {
  private constructor(private readonly deps: PulledUsageRetractionDeps) {}

  static create(deps: PulledUsageRetractionDeps): PulledUsageRetractionIntent {
    return new PulledUsageRetractionIntent(deps);
  }

  async execute(payload: RetractPulledUsagePayload): Promise<void> {
    if (!(await this.deps.retractionEnabled(payload.organization_id))) {
      logger.info(
        { restatementKey: payload.restatement_key, organizationId: payload.organization_id },
        "pulled usage reissue detected but withdrawal is disabled; the superseded version is left standing",
      );
      return;
    }

    logger.info(
      {
        restatementKey: payload.restatement_key,
        source: payload.source,
        retractedCurrencyCode: payload.currency_code,
        retractedAgentId: payload.agent_id,
        retractedRawActorId: payload.raw_actor_id,
        retractedModel: payload.model,
        observedAtMs: payload.observed_at_ms,
      },
      "withdrawing a pulled usage version superseded by a reissue",
    );

    await this.deps.sendRetractPulledUsage({
      tenantId: payload.tenant_id,
      occurredAt: payload.occurred_at_ms,
      restatementKey: payload.restatement_key,
      source: payload.source,
      ingestionSourceId: payload.ingestion_source_id,
      organizationId: payload.organization_id,
      model: payload.model,
      costNanoMinor: 0,
      currencyCode: payload.currency_code,
      costNanoUsd: null,
      rawActorId: payload.raw_actor_id,
      agentId: payload.agent_id,
      occurredAtMs: payload.occurred_at_ms,
      observedAtMs: payload.observed_at_ms,
    });
  }
}
