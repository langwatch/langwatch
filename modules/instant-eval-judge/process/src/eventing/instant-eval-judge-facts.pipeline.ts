/**
 * The judge folds billing's usage-billed fact (ADR-174 decision 13), so it calls no peer;
 * project placement is read through shares (R40).
 * Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import {
  USAGE_BILLING_CHANGED_EVENT_TYPE,
  usageBillingChangedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { InstantEvalJudgeModule } from "../app/instant-eval-judge.app.ts";
import type { InstantEvalJudgeRepositories } from "../repositories/instant-eval-judge.repositories.ts";
import type { InstantEvalJudgeFactsService } from "../services/instant-eval-judge-facts.service.ts";

const INSTANT_EVAL_JUDGE_FACTS_PIPELINE_NAME = "instant_eval_judge_facts" as const;

export type InstantEvalJudgeFactsPipeline = StaticPipelineDefinition<never>;

export function buildInstantEvalJudgeFactsPipeline({
  facts,
}: {
  facts: InstantEvalJudgeFactsService;
}): InstantEvalJudgeFactsPipeline {
  return (
    definePipeline({
      name: INSTANT_EVAL_JUDGE_FACTS_PIPELINE_NAME,
      // `global`: this pipeline appends no events of its own; it only folds its peers'.
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      // An upsert by key, the newest stamp winning: a redelivered or late fact changes nothing.
      .withPeerSubscriber("instantEvalJudgeUsageBillingChanged", {
        eventType: USAGE_BILLING_CHANGED_EVENT_TYPE,
        data: usageBillingChangedEventDataSchema,
        handle: ({ organizationId, usageBilled, occurredAt, fromCatchUp }) =>
          facts.usageBillingChanged({ organizationId, usageBilled, occurredAt, fromCatchUp }),
      })
      .build()
  );
}

export const instantEvalJudgeFactsEventing = defineEventingModule({
  pipeline: INSTANT_EVAL_JUDGE_FACTS_PIPELINE_NAME,
  build: ({ app }: EventingSetup<InstantEvalJudgeRepositories, InstantEvalJudgeModule>) =>
    app.factsPipeline(),
});
