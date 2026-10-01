import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  GUIDED_ONBOARDING_AGGREGATE_TYPE,
  GUIDED_ONBOARDING_LIFECYCLE_PIPELINE_NAME,
} from "@langwatch/onboarding-contract";

import type { OnboardingApp } from "../app/onboarding.app.ts";
import { RecordGuidedOnboardingCommand } from "./guided-onboarding-lifecycle.commands.ts";
import {
  guidedOnboardingRecordedEventSchema,
  type GuidedOnboardingLifecycleEvent,
  type RecordGuidedOnboardingCommandData,
} from "./guided-onboarding-lifecycle.events.ts";

export type GuidedOnboardingLifecyclePipeline = StaticPipelineDefinition<
  GuidedOnboardingLifecycleEvent,
  Record<string, Projection>,
  { name: "recordGuidedOnboarding"; payload: RecordGuidedOnboardingCommandData }
>;

/** guided_onboarding_lifecycle: onboarding records its facts; peers react from their side (§9). */
export function buildGuidedOnboardingLifecyclePipeline(): GuidedOnboardingLifecyclePipeline {
  return definePipeline({
    name: GUIDED_ONBOARDING_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: GUIDED_ONBOARDING_AGGREGATE_TYPE }),
  })
    .withEvents([guidedOnboardingRecordedEventSchema])
    .withCommand("recordGuidedOnboarding", RecordGuidedOnboardingCommand)
    .build();
}

export const guidedOnboardingLifecycleEventing = defineEventingModule({
  pipeline: GUIDED_ONBOARDING_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, OnboardingApp>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
