/**
 * The ledger row one Instant Evals judge call writes, from the judge's priced fact (ADR-174
 * decision 13). The customer price is the row's cost, as for a run or a judged query, and our own
 * cost rides in the metadata. Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import type { GatewayPricedSpend } from "@langwatch/gateway-contract";
import {
  INSTANT_EVAL_REQUEST_TYPE,
  type InstantEvalJudgeSpendPricedEventData,
} from "@langwatch/instant-eval-judge-contract";

const NANO_USD_PER_USD = 1_000_000_000;

export function gatewayPricedSpendOfJudge({
  fact,
  teamId,
}: {
  fact: InstantEvalJudgeSpendPricedEventData;
  teamId: string;
}): GatewayPricedSpend {
  return {
    requestId: fact.requestId,
    projectId: fact.projectId,
    organizationId: fact.organizationId,
    teamId,
    requestType: INSTANT_EVAL_REQUEST_TYPE,
    model: fact.model,
    rateVersion: fact.rateVersion,
    inputTokens: fact.inputTokens,
    costNanoUsd: fact.priceNanoUsd,
    metadata: JSON.stringify({
      instant_eval: { cost_usd: fact.costNanoUsd / NANO_USD_PER_USD, requests: 1 },
    }),
    occurredAt: fact.occurredAt,
  };
}
