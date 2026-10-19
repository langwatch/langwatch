import {
  type CommandEnvelope,
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { TenantMigrationRolledBackEventData } from "@langwatch/ops-contract";
import { nowInstant } from "@langwatch/time";
import type { z } from "zod";

import type { OpsModule } from "../app/ops.app.ts";
import type { OpsRepositories } from "../repositories/ops.repositories.ts";
import {
  RecordTenantMigrationRolledBackCommand,
  RequestSystemMigrationPassCommand,
  SYSTEM_MIGRATION_PASS_AGGREGATE_TYPE,
  type SystemMigrationPassRequestedEvent,
  type systemMigrationPassRequestedEventDataSchema,
  systemMigrationPassRequestedEventSchema,
  type TenantMigrationRolledBackEvent,
  tenantMigrationRolledBackEventSchema,
} from "./ops-system-migrations.commands.ts";
import {
  SYSTEM_MIGRATION_PASS_PROCESS_NAME,
  runSystemMigrationPass,
} from "./ops-system-migrations.intent.ts";
import {
  SYSTEM_MIGRATION_PASS_INITIAL_STATE,
  SYSTEM_MIGRATION_WAKE_INTERVAL_MS,
  systemMigrationPassIntentSchema,
  systemMigrationPassRequested,
  systemMigrationPassStateSchema,
  systemMigrationRedriveWake,
} from "./ops-system-migrations.process.ts";

export const SYSTEM_MIGRATIONS_PIPELINE_NAME = "ops_system_migrations";

type SystemMigrationsPipelineDefinition = StaticPipelineDefinition<
  SystemMigrationPassRequestedEvent | TenantMigrationRolledBackEvent,
  Record<string, Projection>,
  | {
      name: "requestSystemMigrationPass";
      payload: z.infer<typeof systemMigrationPassRequestedEventDataSchema> & CommandEnvelope;
    }
  | {
      name: "recordTenantMigrationRolledBack";
      payload: TenantMigrationRolledBackEventData & CommandEnvelope;
    }
>;

/**
 * The migration pass as one scheduled process: a short wake once across the fleet runs a pass while
 * one is pending and hourly once nothing is, and an operator's kick is a command whose event asks
 * the same intent. Only a worker hosts it.
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
    .withEvents([systemMigrationPassRequestedEventSchema, tenantMigrationRolledBackEventSchema])
    .withCommand("requestSystemMigrationPass", RequestSystemMigrationPassCommand)
    .withCommand("recordTenantMigrationRolledBack", RecordTenantMigrationRolledBackCommand)
    .withProcessManager(SYSTEM_MIGRATION_PASS_PROCESS_NAME, (pm) =>
      pm
        .state(systemMigrationPassStateSchema, SYSTEM_MIGRATION_PASS_INITIAL_STATE)
        .schedule({ everyMs: SYSTEM_MIGRATION_WAKE_INTERVAL_MS })
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
        // One pass at a time on a short, renewed lease. Tenant steps work in pages through
        // their repositories, so each call keeps the lease and the default silence limit holds.
        .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1 }),
    )
    .build();
}

/** Passive in the api, which only sends the kick; the worker wakes and runs the passes. */
export const systemMigrationsEventing = defineEventingModule({
  pipeline: SYSTEM_MIGRATIONS_PIPELINE_NAME,
  build: (setup: EventingSetup<OpsRepositories, OpsModule>) => buildSystemMigrations(setup),
  connect: ({ app, commands }) => app.connectSystemMigrationCommands(commands),
});
