/**
 * insight_daily_run: one aggregate per person and board, one Postgres projection (the run's
 * row), three commands and the process that hands each run to the outbox. The api and the
 * tasks send; the worker folds and carries the run out.
 * @see modules/insight/adrs/004-daily-run.md
 */

import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StateProjectionStore,
} from "@langwatch/eventing";
import {
  INSIGHT_DAILY_RUN_PIPELINE_NAME,
  INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE,
} from "@langwatch/insight-contract";

import type { InsightModule } from "../app/insight.app.ts";
import type { InsightRepositories } from "../repositories/insight.repositories.ts";
import {
  RecordInsightRunStartedCommand,
  RequestInsightRunCommand,
  SettleInsightRunCommand,
} from "./insight-daily-run.commands.ts";
import {
  INSIGHT_DAILY_RUN_EVENT_SCHEMAS,
  InsightRunRequestedEventSchema,
  InsightRunSettledEventSchema,
} from "./insight-daily-run.events.ts";
import {
  INSIGHT_DAILY_RUN_INTENT,
  INSIGHT_DAILY_RUN_LEASE_MS,
  INSIGHT_DAILY_RUN_MAX_ATTEMPTS,
  type InsightDailyRunExecutor,
  runBoardIntent,
  runBoardIntentSchema,
} from "./insight-daily-run.intent.ts";
import {
  INITIAL_INSIGHT_DAILY_RUN_STATE,
  INSIGHT_DAILY_RUN_PROCESS_NAME,
  insightDailyRunStateSchema,
  insightRunRequested,
  insightRunSettled,
} from "./insight-daily-run.process.ts";
import {
  createInsightDailyScheduleProjection,
  type InsightDailyScheduleState,
} from "./insight-daily-schedule.projection.ts";

interface InsightDailyRunPipelineDeps {
  scheduleStore: StateProjectionStore<InsightDailyScheduleState>;
  runs: InsightDailyRunExecutor;
}

/** A run is a model call that takes minutes: few at once per pod, and no more leased than run. */
const RUNS_AT_ONCE = 2;

const defineInsightDailyRunPipeline = (deps: InsightDailyRunPipelineDeps) =>
  definePipeline({
    name: INSIGHT_DAILY_RUN_PIPELINE_NAME,
    aggregate: defineAggregate({ type: INSIGHT_DAILY_SCHEDULE_AGGREGATE_TYPE }),
  })
    .withEvents(INSIGHT_DAILY_RUN_EVENT_SCHEMAS)
    .withPostgresProjection(createInsightDailyScheduleProjection({ store: deps.scheduleStore }))
    .withCommand("requestRun", RequestInsightRunCommand)
    .withCommand("recordRunStarted", RecordInsightRunStartedCommand)
    .withCommand("settleRun", SettleInsightRunCommand)
    .withProcessManager(INSIGHT_DAILY_RUN_PROCESS_NAME, (pm) =>
      pm
        .state(insightDailyRunStateSchema, INITIAL_INSIGHT_DAILY_RUN_STATE)
        .intent(INSIGHT_DAILY_RUN_INTENT, runBoardIntentSchema, runBoardIntent({ runs: deps.runs }))
        .on(InsightRunRequestedEventSchema, insightRunRequested)
        .on(InsightRunSettledEventSchema, insightRunSettled)
        .outbox({
          maxAttempts: INSIGHT_DAILY_RUN_MAX_ATTEMPTS,
          leaseDurationMs: INSIGHT_DAILY_RUN_LEASE_MS,
          concurrency: RUNS_AT_ONCE,
          batchSize: RUNS_AT_ONCE,
        }),
    )
    .build();

export type InsightDailyRunPipelineDefinition = ReturnType<typeof defineInsightDailyRunPipeline>;

/** The definition `insight_daily_run` registers, built once per module. */
export function buildInsightDailyRunPipeline(
  deps: InsightDailyRunPipelineDeps,
): InsightDailyRunPipelineDefinition {
  return defineInsightDailyRunPipeline(deps);
}

export const insightDailyRunEventing = defineEventingModule({
  pipeline: INSIGHT_DAILY_RUN_PIPELINE_NAME,
  build: ({ app }: EventingSetup<InsightRepositories, InsightModule>) => app.dailyRunPipeline(),
  connect: ({ app, commands }) => app.connectDailyRunCommands(commands),
});
