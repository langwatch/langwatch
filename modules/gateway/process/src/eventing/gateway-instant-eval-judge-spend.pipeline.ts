/**
 * Gateway writes the ledger row for each Instant Evals judge call from the judge's own priced
 * fact (ADR-174 decision 13), as it debits governance's priced pulled usage: the leaf calls no
 * gateway Api, so wave 1 adds no peer cycle. The request id keeps a repeat to one row.
 * Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  INSTANT_EVAL_JUDGE_SPEND_PRICED_EVENT_TYPE,
  instantEvalJudgeSpendPricedEventDataSchema,
} from "@langwatch/instant-eval-judge-contract";

import type { GatewayModule } from "../app/gateway.app.ts";
import type { GatewayRepositories } from "../repositories/gateway.repositories.ts";
import type { GatewayInstantEvalJudgeSpendService } from "../services/gateway-instant-eval-judge-spend.service.ts";

const GATEWAY_INSTANT_EVAL_JUDGE_SPEND_PIPELINE_NAME = "gateway_instant_eval_judge_spend" as const;

export type GatewayInstantEvalJudgeSpendPipeline = StaticPipelineDefinition<never>;

export function buildGatewayInstantEvalJudgeSpendPipeline({
  spend,
}: {
  spend: Pick<GatewayInstantEvalJudgeSpendService, "recordJudgeSpend">;
}): GatewayInstantEvalJudgeSpendPipeline {
  return (
    definePipeline({
      name: GATEWAY_INSTANT_EVAL_JUDGE_SPEND_PIPELINE_NAME,
      // `global`: gateway appends no events here; it only writes the judge's.
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      // The spine keys a confirm by project and request, so a redelivery writes one row.
      .withPeerSubscriber("gatewayInstantEvalJudgeSpendRow", {
        eventType: INSTANT_EVAL_JUDGE_SPEND_PRICED_EVENT_TYPE,
        data: instantEvalJudgeSpendPricedEventDataSchema,
        handle: (fact) => spend.recordJudgeSpend({ fact }),
      })
      .build()
  );
}

export const gatewayInstantEvalJudgeSpendEventing = defineEventingModule({
  pipeline: GATEWAY_INSTANT_EVAL_JUDGE_SPEND_PIPELINE_NAME,
  build: ({ app }: EventingSetup<GatewayRepositories, GatewayModule>) =>
    app.instantEvalJudgeSpendPipeline(),
});
