/**
 * Suite's own run-processing pipeline (ADR-144), ported from the deleted
 * `SuiteWorkerFeatureInstaller`; its senders are bound back to the app once registered.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type FoldProjectionStore,
  type PeerSubscriberContext,
  type RetentionPolicyResolver,
} from "@langwatch/eventing";
import {
  SIMULATION_RUN_EVENT_TYPES,
  simulationRunEvaluatedEventDataSchema,
  simulationRunFinishedEventDataSchema,
  simulationRunStartedEventDataSchema,
} from "@langwatch/scenario-contract";
import type { SuiteRunStateData } from "@langwatch/suite-contract";
import {
  SuiteRunStartedEventSchema,
  SuiteRunItemStartedEventSchema,
  SuiteRunItemCompletedEventSchema,
  SuiteRunItemRegradedEventSchema,
} from "@langwatch/suite-contract";

import type { SuiteModule } from "../app/suite.app.ts";
import type { SuiteRepositories } from "../repositories/suite.repositories.ts";
import {
  type ScenarioRunFactContext,
  SuiteRunScenarioFactsService,
} from "../services/suite-run-scenario-facts.service.ts";
import { SuiteRunStateFoldProjection } from "./suite-run-state.projection.ts";
import {
  CompleteSuiteRunItemCommand,
  RecordSuiteRunItemStartedCommand,
  RegradeSuiteRunItemCommand,
  StartSuiteRunCommand,
} from "./suite-run.commands.ts";

interface SuiteRunProcessingPipelineDeps {
  suiteRunStateFoldStore: FoldProjectionStore<SuiteRunStateData>;
  /** Each tenant's retention, stamped on the run rows in place of the default (§9). */
  retention?: RetentionPolicyResolver;
  /** Moves a suite run's items as scenario's run facts arrive (peer subscriber, §9). */
  scenarioRunFacts: SuiteRunScenarioFactsService;
}

/**
 * How long a suite command's job id stays claimed.
 */
const SUITE_COMMAND_DEDUP_TTL_MS = 60_000;

/**
 * The command's own job id, required at this seam rather than optional.
 */
function jobId<TPayload>(
  commandName: string,
  makeJobId: ((payload: TPayload) => string) | undefined,
): (payload: TPayload) => string {
  if (!makeJobId) {
    throw new Error(
      `Suite command "${commandName}" is registered with deduplication but defines no makeJobId`,
    );
  }
  return makeJobId;
}

/** The tenant, instant and id a scenario fact landed with. */
function factContext(context: PeerSubscriberContext): ScenarioRunFactContext {
  return {
    tenantId: String(context.tenantId),
    occurredAt: context.occurredAt,
    eventId: context.eventId,
  };
}

/**
 * Creates the suite run processing pipeline definition.
 */
const defineSuiteRunProcessingPipeline = (deps: SuiteRunProcessingPipelineDeps) => {
  const commands = {
    startSuiteRun: StartSuiteRunCommand,
    recordSuiteRunItemStarted: RecordSuiteRunItemStartedCommand,
    completeSuiteRunItem: CompleteSuiteRunItemCommand,
    regradeSuiteRunItem: RegradeSuiteRunItemCommand,
  };

  const pipeline = definePipeline({
    name: "suite_run_processing",
    aggregate: defineAggregate({
      type: "suite_run",
    }),
  })
    .withEvents([
      SuiteRunStartedEventSchema,
      SuiteRunItemStartedEventSchema,
      SuiteRunItemCompletedEventSchema,
      SuiteRunItemRegradedEventSchema,
    ])
    .withClickHouseFoldProjection(
      SuiteRunStateFoldProjection.create({
        store: deps.suiteRunStateFoldStore,
      }),
    )
    // These fold by addition (Started/Completed/FailedCount + 1),
    // deduped by `event.id` — `withCommand` only reads dedup from
    // `makeJobId` in these options; omit it and a redelivery double-counts,
    // flipping status to SUCCESS/FAILURE before the run has finished.
    .withCommand("startSuiteRun", commands.startSuiteRun, {
      deduplication: {
        makeId: jobId("startSuiteRun", commands.startSuiteRun.makeJobId),
        ttlMs: SUITE_COMMAND_DEDUP_TTL_MS,
      },
    })
    .withCommand("recordSuiteRunItemStarted", commands.recordSuiteRunItemStarted, {
      deduplication: {
        makeId: jobId("recordSuiteRunItemStarted", commands.recordSuiteRunItemStarted.makeJobId),
        ttlMs: SUITE_COMMAND_DEDUP_TTL_MS,
      },
    })
    .withCommand("completeSuiteRunItem", commands.completeSuiteRunItem, {
      deduplication: {
        makeId: jobId("completeSuiteRunItem", commands.completeSuiteRunItem.makeJobId),
        ttlMs: SUITE_COMMAND_DEDUP_TTL_MS,
      },
    })
    .withCommand("regradeSuiteRunItem", commands.regradeSuiteRunItem, {
      deduplication: {
        makeId: jobId("regradeSuiteRunItem", commands.regradeSuiteRunItem.makeJobId),
        ttlMs: SUITE_COMMAND_DEDUP_TTL_MS,
      },
    })
    .withPeerSubscriber("scenarioRunStarted", {
      eventType: SIMULATION_RUN_EVENT_TYPES.STARTED,
      data: simulationRunStartedEventDataSchema,
      options: { enqueue: { filter: (data) => SuiteRunScenarioFactsService.belongsToSuite(data) } },
      handle: (data, context) => deps.scenarioRunFacts.recordStarted(data, factContext(context)),
    })
    .withPeerSubscriber("scenarioRunFinished", {
      eventType: SIMULATION_RUN_EVENT_TYPES.FINISHED,
      data: simulationRunFinishedEventDataSchema,
      options: { enqueue: { filter: (data) => SuiteRunScenarioFactsService.belongsToSuite(data) } },
      handle: (data, context) => deps.scenarioRunFacts.recordFinished(data, factContext(context)),
    })
    .withPeerSubscriber("scenarioRunEvaluated", {
      eventType: SIMULATION_RUN_EVENT_TYPES.EVALUATED,
      data: simulationRunEvaluatedEventDataSchema,
      options: { enqueue: { filter: (data) => SuiteRunScenarioFactsService.belongsToSuite(data) } },
      handle: (data, context) => deps.scenarioRunFacts.recordEvaluated(data, factContext(context)),
    });
  return (deps.retention ? pipeline.withRetention(deps.retention) : pipeline).build();
};

/**
 * The definition this feature registers, named so a composition root can hold
 * one without restating its shape.
 */
export type SuiteRunProcessingPipeline = ReturnType<typeof defineSuiteRunProcessingPipeline>;

export function buildSuiteRunProcessingPipeline(
  deps: SuiteRunProcessingPipelineDeps,
): SuiteRunProcessingPipeline {
  return defineSuiteRunProcessingPipeline(deps);
}

export const suiteRunProcessingEventing = defineEventingModule({
  pipeline: "suite_run_processing",
  build: ({ app }: EventingSetup<SuiteRepositories, SuiteModule>) => app.eventingPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
