import {
  type CommandEnvelope,
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { z } from "zod";

import type { OpsApp } from "../app/ops.app.ts";
import type { OpsRepositories } from "../repositories/ops.repositories.ts";
import { RecordPlatformOperatorSeedCommand } from "./ops-platform-operator-seed.commands.ts";
import {
  PLATFORM_OPERATOR_SEED_AGGREGATE_TYPE,
  type PlatformOperatorSeedRecordedEvent,
  type platformOperatorSeedRecordedEventDataSchema,
  platformOperatorSeedRecordedEventSchema,
} from "./ops-platform-operator-seed.events.ts";
import {
  PLATFORM_OPERATOR_SEED_PROCESS_NAME,
  PLATFORM_OPERATOR_SEED_WAKE_INTERVAL_MS,
  platformOperatorSeedGrantIntentSchema,
  platformOperatorSeedIntentSchema,
  platformOperatorSeedRecorded,
  platformOperatorSeedStateSchema,
  platformOperatorSeedWake,
} from "./ops-platform-operator-seed.process.ts";

export const PLATFORM_OPERATOR_SEED_PIPELINE_NAME = "ops_platform_operator_seed";

export type PlatformOperatorSeedPipelineDefinition = StaticPipelineDefinition<
  PlatformOperatorSeedRecordedEvent,
  Record<string, Projection>,
  {
    name: "recordPlatformOperatorSeed";
    payload: z.infer<typeof platformOperatorSeedRecordedEventDataSchema> & CommandEnvelope;
  }
>;

/**
 * The one-time platform-operator seed (ARCHITECTURE.md, "Operator bootstrap"): wakes ask for an
 * attempt until the seed records its decision as ops's own event, which sets the marker for good
 * and asks for the grants that decision names.
 */
export function buildPlatformOperatorSeed({
  app,
}: EventingSetup<
  unknown,
  Pick<OpsApp, "seedPlatformOperators" | "grantSeededPlatformOperators">
>): PlatformOperatorSeedPipelineDefinition {
  return definePipeline({
    name: PLATFORM_OPERATOR_SEED_PIPELINE_NAME,
    aggregate: defineAggregate({ type: PLATFORM_OPERATOR_SEED_AGGREGATE_TYPE }),
  })
    .withEvents([platformOperatorSeedRecordedEventSchema])
    .withCommand("recordPlatformOperatorSeed", RecordPlatformOperatorSeedCommand)
    .withProcessManager(PLATFORM_OPERATOR_SEED_PROCESS_NAME, (pm) =>
      pm
        .state(platformOperatorSeedStateSchema, { seededAt: null })
        .schedule({ everyMs: PLATFORM_OPERATOR_SEED_WAKE_INTERVAL_MS })
        .onWake(platformOperatorSeedWake)
        .intent("seed", platformOperatorSeedIntentSchema, async () => {
          await app.seedPlatformOperators();
        })
        .intent("grant", platformOperatorSeedGrantIntentSchema, async (decision) => {
          await app.grantSeededPlatformOperators(decision);
        })
        .on(platformOperatorSeedRecordedEventSchema, platformOperatorSeedRecorded)
        .outbox({ maxAttempts: 5, concurrency: 1, batchSize: 1, leaseDurationMs: 60 * 1000 }),
    )
    .build();
}

export const platformOperatorSeedEventing = defineEventingModule({
  pipeline: PLATFORM_OPERATOR_SEED_PIPELINE_NAME,
  build: (setup: EventingSetup<OpsRepositories, OpsApp>) => buildPlatformOperatorSeed(setup),
  connect: ({ app, commands }) => app.connectPlatformOperatorSeedCommands(commands),
});
