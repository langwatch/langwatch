/**
 * The ledger row one PII redaction model call writes, from data-privacy's priced fact (ADR-201).
 * The customer price is the row's cost; our cost and the characters ride in the metadata.
 * Spec: modules/data-privacy/specs/pii-redaction-billing.feature
 */
import {
  PII_REDACTION_REQUEST_TYPE,
  type PiiRedactionSpendPricedEventData,
} from "@langwatch/data-privacy-contract/pii-redaction-spend";
import type { GatewayPricedSpend } from "@langwatch/gateway-contract";

const NANO_USD_PER_USD = 1_000_000_000;

export function gatewayPricedSpendOfPiiRedaction({
  fact,
  teamId,
}: {
  fact: PiiRedactionSpendPricedEventData;
  teamId: string;
}): GatewayPricedSpend {
  return {
    requestId: fact.requestId,
    projectId: fact.projectId,
    organizationId: fact.organizationId,
    teamId,
    requestType: PII_REDACTION_REQUEST_TYPE,
    model: fact.model,
    rateVersion: fact.rateVersion,
    // Characters are not tokens; they ride in the metadata.
    inputTokens: 0,
    costNanoUsd: fact.priceNanoUsd,
    metadata: JSON.stringify({
      pii_redaction: {
        cost_usd: fact.costNanoUsd / NANO_USD_PER_USD,
        characters: fact.characters,
        texts: fact.texts,
      },
    }),
    occurredAt: fact.occurredAt,
  };
}
