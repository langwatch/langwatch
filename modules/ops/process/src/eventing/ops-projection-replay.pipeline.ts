import {
  type CommandEnvelope,
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { OpsModule } from "../app/ops.app.ts";
import type { OpsRepositories } from "../repositories/ops.repositories.ts";
import { RequestProjectionReplayCommand } from "./ops-projection-replay.commands.ts";
import {
  PROJECTION_REPLAY_AGGREGATE_TYPE,
  PROJECTION_REPLAY_PIPELINE_NAME,
  type ProjectionReplayRequestedEvent,
  type ProjectionReplayRun,
  projectionReplayRequestedEventSchema,
  projectionReplayRunSchema,
} from "./ops-projection-replay.events.ts";
import {
  PROJECTION_REPLAY_INITIAL_STATE,
  PROJECTION_REPLAY_LEASE_MS,
  PROJECTION_REPLAY_PROCESS_NAME,
  onProjectionReplayRequested,
  projectionReplayStateSchema,
} from "./ops-projection-replay.process.ts";

export type ProjectionReplayDefinition = StaticPipelineDefinition<
  ProjectionReplayRequestedEvent,
  Record<string, Projection>,
  { name: "requestProjectionReplay"; payload: ProjectionReplayRun & CommandEnvelope }
>;

/**
 * An operator's projection replay executes on its pipeline, never in a request (ARCHITECTURE §9):
 * the api records the run and sends the command, a worker's intent runs it to its end.
 */
export function buildProjectionReplay({
  app,
}: EventingSetup<unknown, Pick<OpsModule, "executeReplay">>): ProjectionReplayDefinition {
  return definePipeline({
    name: PROJECTION_REPLAY_PIPELINE_NAME,
    aggregate: defineAggregate({ type: PROJECTION_REPLAY_AGGREGATE_TYPE }),
  })
    .withEvents([projectionReplayRequestedEventSchema])
    .withCommand("requestProjectionReplay", RequestProjectionReplayCommand)
    .withProcessManager(PROJECTION_REPLAY_PROCESS_NAME, (pm) =>
      pm
        .state(projectionReplayStateSchema, PROJECTION_REPLAY_INITIAL_STATE)
        .intent("execute", projectionReplayRunSchema, (run) => app.executeReplay(run))
        .on(projectionReplayRequestedEventSchema, onProjectionReplayRequested)
        // One run at a time, never retried: a lapsed lease retires the delivery, not re-runs it.
        .outbox({
          leaseDurationMs: PROJECTION_REPLAY_LEASE_MS,
          maxAttempts: 1,
          concurrency: 1,
          batchSize: 1,
        }),
    )
    .build();
}

export const projectionReplayEventing = defineEventingModule({
  pipeline: PROJECTION_REPLAY_PIPELINE_NAME,
  build: (setup: EventingSetup<OpsRepositories, OpsModule>) => buildProjectionReplay(setup),
  connect: ({ app, commands }) => app.connectReplay(commands),
});
