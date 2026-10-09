import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
/**
 * The judge's own priced facts, one per judge call, on the organization's aggregate (ADR-174
 * decision 13). Its subscriber writes one spend row per request id and never rewrites one, so a
 * repeated fact adds nothing. Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import {
  INSTANT_EVAL_JUDGE_SPEND_AGGREGATE_TYPE,
  INSTANT_EVAL_JUDGE_SPEND_PIPELINE_NAME,
  INSTANT_EVAL_JUDGE_SPEND_PRICED_EVENT_TYPE,
  type InstantEvalJudgeSpendPricedEventData,
} from "@langwatch/instant-eval-judge-contract";

import type { InstantEvalJudgeModule } from "../app/instant-eval-judge.app.ts";
import type { InstantEvalJudgeRepositories } from "../repositories/instant-eval-judge.repositories.ts";
import type { InstantEvalJudgeFactsService } from "../services/instant-eval-judge-facts.service.ts";
import {
  type InstantEvalJudgeSpendPricedEvent,
  instantEvalJudgeSpendPricedEventSchema,
  RecordInstantEvalJudgeSpendPricedCommand,
} from "./instant-eval-judge-spend.commands.ts";

export type InstantEvalJudgeSpendPipeline = StaticPipelineDefinition<
  InstantEvalJudgeSpendPricedEvent,
  Record<string, Projection>,
  { name: "recordSpendPriced"; payload: InstantEvalJudgeSpendPricedEventData }
>;

export function buildInstantEvalJudgeSpendPipeline({
  facts,
}: {
  facts: Pick<InstantEvalJudgeFactsService, "recordSpend">;
}): InstantEvalJudgeSpendPipeline {
  return definePipeline({
    name: INSTANT_EVAL_JUDGE_SPEND_PIPELINE_NAME,
    aggregate: defineAggregate({ type: INSTANT_EVAL_JUDGE_SPEND_AGGREGATE_TYPE }),
  })
    .withEvents([instantEvalJudgeSpendPricedEventSchema])
    .withCommand("recordSpendPriced", RecordInstantEvalJudgeSpendPricedCommand)
    .withEventSubscriber("instantEvalJudgeSpendRow", {
      events: [INSTANT_EVAL_JUDGE_SPEND_PRICED_EVENT_TYPE],
      handler: async (event) => {
        const { organizationId, requestId, priceNanoUsd, occurredAt } = event.data;
        await facts.recordSpend({
          organizationId,
          requestId,
          spendNanoUsd: BigInt(priceNanoUsd),
          occurredAtMs: occurredAt,
        });
      },
    })
    .build();
}

export const instantEvalJudgeSpendEventing = defineEventingModule({
  pipeline: INSTANT_EVAL_JUDGE_SPEND_PIPELINE_NAME,
  build: ({ app }: EventingSetup<InstantEvalJudgeRepositories, InstantEvalJudgeModule>) =>
    app.spendPipeline(),
  connect: ({ app, commands }) => app.connectSpendCommands(commands),
});
