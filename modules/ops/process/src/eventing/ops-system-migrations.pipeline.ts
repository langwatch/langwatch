import {
  type CommandEnvelope,
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import type { z } from "zod";

import type { OpsModule } from "../app/ops.app.ts";
import type { OpsRepositories } from "../repositories/ops.repositories.ts";
import { RequestSystemMigrationPassCommand } from "./ops-system-migrations.commands.ts";
import {
  SYSTEM_MIGRATION_PASS_AGGREGATE_TYPE,
  type SystemMigrationPassRequestedEvent,
  type systemMigrationPassRequestedEventDataSchema,
  systemMigrationPassRequestedEventSchema,
} from "./ops-system-migrations.events.ts";
import {
  SYSTEM_MIGRATION_PASS_PROCESS_NAME,
  runSystemMigrationPass,
} from "./ops-system-migrations.intent.ts";
import {
  SYSTEM_MIGRATION_PASS_INITIAL_STATE,
  SYSTEM_MIGRATION_REDRIVE_INTERVAL_MS,
  systemMigrationPassIntentSchema,
  systemMigrationPassRequested,
  systemMigrationPassStateSchema,
  systemMigrationRedriveWake,
} from "./ops-system-migrations.process.ts";

export const SYSTEM_MIGRATIONS_PIPELINE_NAME = "ops_system_migrations";

export type SystemMigrationsPipelineDefinition = StaticPipelineDefinition<
  SystemMigrationPassRequestedEvent,
  Record<string, Projection>,
  {
    name: "requestSystemMigrationPass";
    payload: z.infer<typeof systemMigrationPassRequestedEventDataSchema> & CommandEnvelope;
  }
>;

/**
 * The migration pass as one scheduled process: the hourly re-drive wakes it once across the fleet,
 * and an operator's kick is a command whose event asks the same intent. Only a worker hosts it.
 */
export function buildSystemMigrations({
  app,
  processStore,
}: EventingSetup<
  unknown,
  Pick<OpsModule, "executeSystemMigrationPass">
>): SystemMigrationsPipelineDefinition {
  return definePipeline({
    name: SYSTEM_MIGRATIONS_PIPELINE_NAME,
    aggregate: defineAggregate({ type: SYSTEM_MIGRATION_PASS_AGGREGATE_TYPE }),
  })
    .withEvents([systemMigrationPassRequestedEventSchema])
    .withCommand("requestSystemMigrationPass", RequestSystemMigrationPassCommand)
    .withProcessManager(SYSTEM_MIGRATION_PASS_PROCESS_NAME, (pm) =>
      pm
        .state(systemMigrationPassStateSchema, SYSTEM_MIGRATION_PASS_INITIAL_STATE)
        .schedule({ everyMs: SYSTEM_MIGRATION_REDRIVE_INTERVAL_MS })
        .onWake(systemMigrationRedriveWake)
        .intent(
          "runPass",
          systemMigrationPassIntentSchema,
          runSystemMigrationPass({
            execute: (input) => app.executeSystemMigrationPass(input),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
            now: () => nowInstant().epochMilliseconds,
          }),
        )
        .on(systemMigrationPassRequestedEventSchema, systemMigrationPassRequested)
        // One pass at a time; a lease as long as the cadence, since a pass can sweep the fleet.
        .outbox({
          leaseDurationMs: SYSTEM_MIGRATION_REDRIVE_INTERVAL_MS,
          maxAttempts: 3,
          concurrency: 1,
          batchSize: 1,
        }),
    )
    .build();
}

/** Passive in the api, which only sends the kick; the worker wakes and runs the passes. */
export const systemMigrationsEventing = defineEventingModule({
  pipeline: SYSTEM_MIGRATIONS_PIPELINE_NAME,
  build: (setup: EventingSetup<OpsRepositories, OpsModule>) => buildSystemMigrations(setup),
  connect: ({ app, commands }) => app.connectSystemMigrationCommands(commands),
});
