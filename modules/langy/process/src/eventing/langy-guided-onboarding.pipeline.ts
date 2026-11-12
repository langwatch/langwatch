import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  LANGY_GUIDED_ONBOARDING_AGGREGATE_TYPE,
  LANGY_GUIDED_ONBOARDING_PIPELINE_NAME,
} from "@langwatch/langy-contract";

import type { LangyModule } from "../app/langy.app.ts";
import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";
import {
  RecordGuidedOnboardingTurnFailedCommand,
  RecordLangyFirstMessageSeenCommand,
} from "./langy-guided-onboarding.commands.ts";
import {
  guidedOnboardingTurnFailedEventSchema,
  type GuidedOnboardingTurnFailedEvent,
  langyFirstMessageSeenEventSchema,
  type LangyFirstMessageSeenEvent,
  type RecordGuidedOnboardingTurnFailedCommandData,
  type RecordLangyFirstMessageSeenCommandData,
} from "./langy-guided-onboarding.events.ts";

export type LangyGuidedOnboardingPipeline = StaticPipelineDefinition<
  GuidedOnboardingTurnFailedEvent | LangyFirstMessageSeenEvent,
  Record<string, Projection>,
  | {
      name: "recordGuidedOnboardingTurnFailed";
      payload: RecordGuidedOnboardingTurnFailedCommandData;
    }
  | { name: "recordLangyFirstMessageSeen"; payload: RecordLangyFirstMessageSeenCommandData }
>;

/** langy_guided_onboarding: langy records its onboarding facts; peers react (§9). */
export function buildLangyGuidedOnboardingPipeline(): LangyGuidedOnboardingPipeline {
  return definePipeline({
    name: LANGY_GUIDED_ONBOARDING_PIPELINE_NAME,
    aggregate: defineAggregate({ type: LANGY_GUIDED_ONBOARDING_AGGREGATE_TYPE }),
  })
    .withEvents([guidedOnboardingTurnFailedEventSchema, langyFirstMessageSeenEventSchema])
    .withCommand("recordGuidedOnboardingTurnFailed", RecordGuidedOnboardingTurnFailedCommand)
    .withCommand("recordLangyFirstMessageSeen", RecordLangyFirstMessageSeenCommand)
    .build();
}

export const langyGuidedOnboardingEventing = defineEventingModule({
  pipeline: LANGY_GUIDED_ONBOARDING_PIPELINE_NAME,
  build: ({ app }: EventingSetup<LangyRepositories, LangyModule>) => app.guidedOnboardingPipeline(),
  connect: ({ app, commands }) => app.connectGuidedOnboardingCommands(commands),
});
