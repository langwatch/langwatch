/**
 * Every `scenarios.*` procedure, declared once. The namespace is flat on
 * purpose: it is one wire name the browser has always called, covering the
 * cases a project defines, their version history, the runs those cases
 * produced, the live stream of those runs, cancellation, the Results tab and
 * the run dialog's configuration history.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { MAX_ATOM_PAGE } from "./result-atoms.ts";
import { runNoteSchema } from "./run-note.ts";
import { runParameterValuesSchema, scenarioParameterDefinitionsSchema } from "./scenario.parameters.ts";
import {
  MAX_RUN_CONFIGURATIONS,
  resultAtomsPageSchema,
  resultsOverviewSchema,
  runConfigurationEntrySchema,
  runTargetSchema,
  codeScenarioSchema,
  scenarioBatchArchiveResultSchema,
  scenarioCancelBatchRunResultSchema,
  scenarioCancelJobResultSchema,
  scenarioRunScheduledSchema,
  scenarioVersionPageSchema,
} from "./scenario.responses.ts";
import { scenarioSchema } from "./scenario.ts";
import { scenarioVersionDetailSchema } from "./scenario.version.ts";
import {
  simulationAllSuitesRunDataSchema,
  simulationBatchHistorySchema,
  simulationBatchRunCountSchema,
  simulationBatchRunDataSchema,
  simulationExternalSetSummarySchema,
  simulationLastResultSummarySchema,
  simulationRunDataSchema,
  simulationRunFreshnessSchema,
  simulationScenarioSetRunDataSchema,
  simulationSetDataSchema,
  simulationStreamFrameSchema,
} from "./simulation.ts";

/** The project every procedure below is asked of. */
const projectSchema = z.object({ projectId: z.string() });

/** The window a run read is asked over; absent ends up as the last 30 days. */
const dateRangeFields = {
  startDate: z.number().int().nonnegative().optional(),
  endDate: z.number().int().nonnegative().optional(),
} as const;

const scenarioIdSchema = projectSchema.extend({ id: z.string() });

export const scenarioTrpcCreateSchema = projectSchema.extend({
  name: z.string().min(1),
  situation: z.string(),
  criteria: z.array(z.string()).default([]),
  labels: z.array(z.string()).default([]),
  // Optional per-scenario model overrides; null clears back to the project
  // default (scenarios.user_simulator / scenarios.judge).
  simulatorModel: z.string().nullish(),
  judgeModel: z.string().nullish(),
  // The parameters the scenario declares, each with an optional description
  // and default. A run supplies values for these names.
  parameters: scenarioParameterDefinitionsSchema.optional(),
  // Turn config (ADR-015); null clears back to SDK default.
  maxTurns: z.number().int().min(1).max(100).nullish(),
  minTurns: z.number().int().min(0).max(100).nullish(),
  // The test suite this case is filed in; absent or null = unfiled.
  testSuiteId: z.string().nullish(),
});

export const scenarioTrpcUpdateSchema = projectSchema.extend({
  id: z.string(),
  name: z.string().min(1).optional(),
  situation: z.string().optional(),
  criteria: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  simulatorModel: z.string().nullish(),
  judgeModel: z.string().nullish(),
  parameters: scenarioParameterDefinitionsSchema.optional(),
  maxTurns: z.number().int().min(1).max(100).nullish(),
  minTurns: z.number().int().min(0).max(100).nullish(),
  // Absent = keep the current test suite; null = unfile; a test suite id = move.
  testSuiteId: z.string().nullish(),
  // The version the editor loaded. When sent, a save against any other
  // version is refused with scenario_stale_version instead of overwriting
  // the newer save. Absent = save over whatever is there.
  expectedVersion: z.number().int().min(1).optional(),
});

/** Target for scenario simulation, extensible by type. */
export const simulationTargetSchema = z.object({
  type: z.enum(["prompt", "http", "code", "workflow"]),
  referenceId: z.string(),
});

export type SimulationTarget = z.infer<typeof simulationTargetSchema>;

export const scenarioTrpcRunSchema = projectSchema.extend({
  scenarioId: z.string(),
  target: simulationTargetSchema,
  /** Optional set id; defaults to the internal on-platform set for ad-hoc runs. */
  setId: z.string().optional(),
  /** Optional client-generated batch run id, for immediate placeholder feedback. */
  batchRunId: z.string().optional(),
  /**
   * Constant values for the run. A value supplied here overrides the
   * scenario's own default for that name.
   */
  parameters: runParameterValuesSchema.optional(),
  /** One short line describing why this run was started. */
  note: runNoteSchema,
});

/**
 * What the Results tab is showing. `endDate` is optional on purpose: the
 * period picker pins its end at mount, so a live view sends only `startDate`
 * and a run that begins while the page is open still lands in the window.
 */
export const resultsFilterSchema = z.object({
  projectId: z.string(),
  startDate: z.number().int().nonnegative().optional(),
  endDate: z.number().int().nonnegative().optional(),
  scenarioIds: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  testSuiteIds: z.array(z.string()).optional(),
  scenarioSetIds: z.array(z.string()).optional(),
  targetKeys: z.array(z.string()).optional(),
  outcome: z.enum(["passed", "failed", "pending"]).optional(),
});

/** The window alone: the scenario filter lists what the window holds. */
const windowSchema = z.object({
  projectId: z.string(),
  startDate: z.number().int().nonnegative().optional(),
  endDate: z.number().int().nonnegative().optional(),
});

export const scenarioTrpc = defineTrpcContract("scenarios")
  // -- the cases a project defines -------------------------------------------
  .mutation("create")
  .withInput(scenarioTrpcCreateSchema)
  .withOutput(scenarioSchema)

  .query("getAll")
  .withInput(projectSchema)
  .withOutput(scenarioSchema.array())

  .query("getById")
  .withInput(scenarioIdSchema)
  .withOutput(scenarioSchema)

  .query("getByIdIncludingArchived")
  .withInput(scenarioIdSchema)
  .withOutput(scenarioSchema.nullable())

  .mutation("update")
  .withInput(scenarioTrpcUpdateSchema)
  .withOutput(scenarioSchema)

  .mutation("archive")
  .withInput(scenarioIdSchema)
  .withOutput(scenarioSchema)

  /** A test suite id files the case there; null unfiles it. */
  .mutation("moveToTestSuite")
  .withInput(
    projectSchema.extend({ scenarioId: z.string(), testSuiteId: z.string().nullable() }),
  )
  .withOutput(scenarioSchema)

  .mutation("duplicate")
  .withInput(projectSchema.extend({ scenarioId: z.string() }))
  .withOutput(scenarioSchema)

  .mutation("batchArchive")
  .withInput(projectSchema.extend({ ids: z.array(z.string()).min(1) }))
  .withOutput(scenarioBatchArchiveResultSchema)

  // -- version history -------------------------------------------------------
  .query("listVersions")
  .withInput(
    projectSchema.extend({
      scenarioId: z.string(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.number().int().optional(),
    }),
  )
  .withOutput(scenarioVersionPageSchema)

  .query("getVersion")
  .withInput(projectSchema.extend({ scenarioId: z.string(), version: z.number().int().min(1) }))
  .withOutput(scenarioVersionDetailSchema)

  .mutation("restoreVersion")
  .withInput(projectSchema.extend({ scenarioId: z.string(), version: z.number().int().min(1) }))
  .withOutput(scenarioSchema)

  // -- running one -----------------------------------------------------------
  /**
   * Schedules the scenario for asynchronous execution and answers at once with
   * the batch run id. It does NOT report whether the run passed.
   */
  .mutation("run")
  .withInput(scenarioTrpcRunSchema)
  .withOutput(scenarioRunScheduledSchema)

  .mutation("cancelJob")
  .withInput(
    projectSchema.extend({
      scenarioSetId: z.string(),
      batchRunId: z.string(),
      scenarioRunId: z.string(),
      scenarioId: z.string(),
    }),
  )
  .withOutput(scenarioCancelJobResultSchema)

  .mutation("cancelBatchRun")
  .withInput(projectSchema.extend({ scenarioSetId: z.string(), batchRunId: z.string() }))
  .withOutput(scenarioCancelBatchRunResultSchema)

  // -- reading what ran ------------------------------------------------------
  .query("getScenarioSetsData")
  .withInput(projectSchema.extend(dateRangeFields))
  .withOutput(simulationSetDataSchema.array())

  /** One suite's runs, or every suite's when no set is named. */
  .query("getSuiteRunData")
  .withInput(
    projectSchema
      .extend({
        scenarioSetId: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
        sinceTimestamp: z.number().optional(),
      })
      .extend(dateRangeFields),
  )
  .withOutput(simulationAllSuitesRunDataSchema)

  /**
   * The latest run result per test case inside the window, for the last-result
   * cells of the cases table. Separate from the case list on purpose: the list
   * renders instantly and these cells stream in.
   */
  .query("getLastResultSummaries")
  .withInput(
    projectSchema.extend({ scenarioIds: z.array(z.string()).optional() }).extend(dateRangeFields),
  )
  .withOutput(simulationLastResultSummarySchema.array())

  /**
   * A cheap freshness probe: the latest update across the project's runs in the
   * window. Clients poll this and invalidate the run reads when it advances.
   */
  .query("getSuiteRunFreshness")
  .withInput(
    projectSchema.extend({ scenarioSetId: z.string().optional() }).extend(dateRangeFields),
  )
  .withOutput(simulationRunFreshnessSchema)

  .query("getScenarioSetRunData")
  .withInput(
    projectSchema
      .extend({
        scenarioSetId: z.string(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      })
      .extend(dateRangeFields),
  )
  .withOutput(simulationScenarioSetRunDataSchema)

  /** @deprecated Use `getSuiteRunData`. Kept for backward compatibility. */
  .query("getAllScenarioSetRunData")
  .withInput(projectSchema.extend({ scenarioSetId: z.string() }).extend(dateRangeFields))
  .withOutput(simulationRunDataSchema.array())

  .query("getRunState")
  .withInput(projectSchema.extend({ scenarioRunId: z.string() }))
  .withOutput(simulationRunDataSchema)

  .query("getScenarioSetBatchRunCount")
  .withInput(projectSchema.extend({ scenarioSetId: z.string() }).extend(dateRangeFields))
  .withOutput(simulationBatchRunCountSchema)

  .query("getScenarioSetBatchHistory")
  .withInput(
    projectSchema
      .extend({
        scenarioSetId: z.string(),
        limit: z.number().min(1).max(100).default(8),
        cursor: z.string().optional(),
      })
      .extend(dateRangeFields),
  )
  .withOutput(simulationBatchHistorySchema)

  .query("getBatchRunData")
  .withInput(
    projectSchema.extend({
      scenarioSetId: z.string(),
      batchRunId: z.string(),
      sinceTimestamp: z.number().optional(),
      runTimestamps: z.record(z.string(), z.number()).optional(),
    }),
  )
  .withOutput(simulationBatchRunDataSchema)

  .query("getExternalSetSummaries")
  .withInput(projectSchema.extend(dateRangeFields))
  .withOutput(simulationExternalSetSummarySchema.array())

  /** @deprecated Use `getSuiteRunData` without a set id. */
  .query("getAllSuiteRunData")
  .withInput(
    projectSchema
      .extend({
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      })
      .extend(dateRangeFields),
  )
  .withOutput(simulationAllSuitesRunDataSchema)

  /**
   * The project's live run stream. `tabKey`/`tabId` are present only on a tab
   * the SDK opened: while the stream lives, that tab is offered runs started on
   * the same machine instead of the SDK opening yet another browser tab.
   */
  .subscription("onSimulationUpdate")
  .withInput(
    z.object({
      projectId: z.string(),
      tabKey: z.string().min(1).max(200).optional(),
      tabId: z.string().min(1).max(200).optional(),
    }),
  )
  .withOutput(simulationStreamFrameSchema)

  // -- the Results tab -------------------------------------------------------
  /**
   * The scenarios that ran from code inside the window, for the scenario
   * filter. They have no row in Postgres, so the stored list cannot name them.
   */
  .query("getCodeScenarios")
  .withInput(windowSchema)
  .withOutput(codeScenarioSchema.array())

  /**
   * The targets the window names that the agent and prompt lists cannot: those
   * a run from code named, and the parameter variants of stored targets.
   */
  .query("getRunTargets")
  .withInput(windowSchema)
  .withOutput(runTargetSchema.array())

  .query("getResultsOverview")
  .withInput(
    resultsFilterSchema.extend({ groupBy: z.enum(["plan", "scenario", "target", "none"]) }),
  )
  .withOutput(resultsOverviewSchema)

  /** One page of atoms, newest first: the drill-down, never a total. */
  .query("getResultAtoms")
  .withInput(
    resultsFilterSchema.extend({
      limit: z.number().int().min(1).max(MAX_ATOM_PAGE).default(100),
      cursor: z.string().optional(),
    }),
  )
  .withOutput(resultAtomsPageSchema)

  /**
   * Every configuration this project's run plans already ran with, newest
   * first, one entry per configuration.
   */
  .query("getRunConfigurations")
  .withInput(
    projectSchema.extend({
      startDate: z.number().int().nonnegative().optional(),
      endDate: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(MAX_RUN_CONFIGURATIONS).optional(),
    }),
  )
  .withOutput(runConfigurationEntrySchema.array())
  .build();
