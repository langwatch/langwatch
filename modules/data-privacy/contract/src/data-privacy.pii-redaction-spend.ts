import type { Named } from "@langwatch/module";
/**
 * One PII redaction model call priced, on the organization's aggregate (ADR-201). Gateway writes
 * it as one `gateway_spend` row keyed by its request id, which billing's meter reads.
 */
import { z } from "zod";

export const PII_REDACTION_SPEND_PIPELINE_NAME = "data_privacy_pii_redaction_spend" as const;
export const PII_REDACTION_SPEND_AGGREGATE_TYPE = "pii_redaction_spend" as const;
export const PII_REDACTION_SPEND_PRICED_EVENT_TYPE =
  "lw.data_privacy.pii_redaction_spend_priced" as const;
export const PII_REDACTION_SPEND_EVENT_VERSION = "2026-11-11" as const;

/** The request type every PII redaction row carries on `gateway_spend`, the one the meter sums. */
export const PII_REDACTION_REQUEST_TYPE = "pii_redaction";

/** The model the ledger names for a PII redaction call. */
export const PII_REDACTION_SPEND_MODEL = "pii-redaction-model";

/** The published price: 0.00005 dollars per 100 characters sent to the model. */
export const PII_REDACTION_NANO_USD_PER_CHARACTER = 500;

/** The rate identity a priced call carries, so a replay is told from a re-rating. */
export const PII_REDACTION_RATE_VERSION = `pii_redaction@${PII_REDACTION_NANO_USD_PER_CHARACTER}nano_per_char`;

const piiRedactionSpendPricedEventDataSchemaDefinition = z.object({
  /** The organization, which the aggregate and its tenant are. */
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  /** Derived from the batch, so a retried ingestion gives the same id. */
  requestId: z.string().min(1),
  model: z.string().min(1),
  rateVersion: z.string().min(1),
  characters: z.number().int().nonnegative(),
  texts: z.number().int().nonnegative(),
  /** The customer price in integer nano-USD; zero for an organization on the free list. */
  priceNanoUsd: z.number().int().nonnegative(),
  /** Our own estimated cost in integer nano-USD, for margin reports only. */
  costNanoUsd: z.number().int().nonnegative(),
});
export interface PiiRedactionSpendPricedEventDataSchema extends Named<
  typeof piiRedactionSpendPricedEventDataSchemaDefinition
> {}
export const piiRedactionSpendPricedEventDataSchema: PiiRedactionSpendPricedEventDataSchema =
  piiRedactionSpendPricedEventDataSchemaDefinition;
export type PiiRedactionSpendPricedEventData = z.infer<
  typeof piiRedactionSpendPricedEventDataSchema
>;
