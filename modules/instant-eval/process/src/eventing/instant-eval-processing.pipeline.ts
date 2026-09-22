/**
 * One projection, five commands and one process manager. The judgements have no
 * map projection on purpose: a page writes up to fifteen hundred rows itself.
 * @see dev/docs/adr/153-instant-eval-run-is-a-judgment-job.md
 */

import {
  defineAggregate,
  defineEventingModule,
  defineEvents,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StateProjectionStore,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  INSTANT_EVAL_AGGREGATE_TYPE,
  INSTANT_EVAL_PIPELINE_NAME,
  INSTANT_EVAL_PROCESSING_EVENT_TYPES,
  type InstantEvalProcessingEvent,
} from "@langwatch/instant-eval-contract";

import type { InstantEvalApp } from "../app/instant-eval.app.ts";
import { INSTANT_EVAL_PROCESS_NAME } from "./instant-eval-processing-data.process.ts";
import {
  instantEvalPageDedupeId,
  InstantEvalProcessingCommandsAdapter,
} from "./instant-eval-processing.commands.ts";
import type { InstantEvalDispatchDeps } from "./instant-eval-processing.intent.ts";
import { instantEvalProcessManager } from "./instant-eval-processing.process.ts";
import {
  createInstantEvalRunProjection,
  type InstantEvalRunProjectionState,
} from "./instant-eval-run.projection.ts";

export interface InstantEvalProcessingPipelineDeps {
  /** The run's counters, on its own row. */
  instantEvalRunStore: StateProjectionStore<InstantEvalRunProjectionState>;
  dispatch: InstantEvalDispatchDeps;
}

/** The pipeline this module registers; commands left `any`, as its peers do. */
export type InstantEvalProcessingPipelineDefinition = StaticPipelineDefinition<
  InstantEvalProcessingEvent,
  Record<string, Projection>,
  any
>;

function buildInstantEvalProcessingPipeline(
  deps: InstantEvalProcessingPipelineDeps,
): InstantEvalProcessingPipelineDefinition {
  const commands = InstantEvalProcessingCommandsAdapter.create();

  return definePipeline<InstantEvalProcessingEvent>({
    name: INSTANT_EVAL_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: INSTANT_EVAL_AGGREGATE_TYPE,
      events: defineEvents(INSTANT_EVAL_PROCESSING_EVENT_TYPES),
    }),
  })
    .withPostgresProjection(createInstantEvalRunProjection({ store: deps.instantEvalRunStore }))
    .withCommand("requestRun", commands.requestRun)
    .withCommand("recordPlanned", commands.recordPlanned)
    .withCommand("recordPageJudged", commands.recordPageJudged, {
      // Suppress a duplicate append for the same page at enqueue: a redelivered
      // page would otherwise write a second event the fold has to recognise.
      // TTL-bound and best-effort; the fold's own page guard is the backstop.
      deduplication: { makeId: instantEvalPageDedupeId, ttlMs: 60_000 },
    })
    .withCommand("requestCancel", commands.requestCancel)
    .withCommand("recordFinished", commands.recordFinished)
    .withProcessManager(INSTANT_EVAL_PROCESS_NAME, instantEvalProcessManager(deps.dispatch))
    .build();
}

/**
 * The composition boundary: importing this module creates no pipeline and
 * registers nothing with a runtime.
 */
export class InstantEvalProcessingPipelineAdapter {
  private constructor() {}

  static create(deps: InstantEvalProcessingPipelineDeps): InstantEvalProcessingPipelineDefinition {
    return buildInstantEvalProcessingPipeline(deps);
  }
}

/**
 * The registration: the app builds the definition, and the senders are bound
 * back to it once the runtime has built them. Passive in the api process,
 * which only sends; the worker drives the intents.
 */
export const instantEvalEventing = defineEventingModule({
  pipeline: INSTANT_EVAL_PIPELINE_NAME,
  // No repository registry: this module builds its own from the ClickHouse
  // member, so the setup carries none.
  build: ({ app }: EventingSetup<undefined, InstantEvalApp>) => app.eventingPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
