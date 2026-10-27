import type { Named } from "@langwatch/module";
import { studioWorkflowSchema, workflowWithVersionSchema } from "@langwatch/workflow-contract";
/**
 * What the experiment feature's tRPC transport answers, stated once: each
 * procedure declares its `withOutput` from here, so the shape a client reads
 * is written down rather than implied by whatever a handler returned.
 */
import { z } from "zod";

import { experimentRunSchema } from "./experiment-run.ts";
import { persistedEvaluationsV3StateSchema } from "./experiment-workbench-persistence.ts";
import {
  workbenchActorLabelSchema,
  workbenchVersionSummarySchema,
} from "./experiment-workbench-version.ts";
import { experimentSchema } from "./experiment.ts";

/**
 * Who last wrote the version a probing tab is comparing against, and the run
 * that wrote it. Both absent on a workbench nothing has claimed.
 */
const workbenchAttributionShape = {
  actorLabel: workbenchActorLabelSchema.optional(),
  runId: z.string().optional(),
} as const;

/** `getEvaluationsV3BySlug`: the full experiment and the workbench state a page opens on. */
const experimentWorkbenchPageSchemaDefinition = z.object({
  ...experimentSchema.shape,
  workbenchState: persistedEvaluationsV3StateSchema.nullable(),
  version: z.number(),
  ...workbenchAttributionShape,
});
export interface ExperimentWorkbenchPageSchema extends Named<
  typeof experimentWorkbenchPageSchemaDefinition
> {}
export const experimentWorkbenchPageSchema: ExperimentWorkbenchPageSchema =
  experimentWorkbenchPageSchemaDefinition;

/** The monitor row `saveAsMonitor` returned on origin/main. */
const experimentPublishedMonitorSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  experimentId: z.string().nullable(),
  evaluatorId: z.string().nullable(),
  checkType: z.string(),
  name: z.string(),
  slug: z.string(),
  executionMode: z.string(),
  enabled: z.boolean(),
  preconditions: z.unknown(),
  parameters: z.json(),
  mappings: z.unknown().nullable(),
  sample: z.number(),
  level: z.string(),
  threadIdleTimeout: z.number().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export interface ExperimentPublishedMonitorSchema extends Named<
  typeof experimentPublishedMonitorSchemaDefinition
> {}
export const experimentPublishedMonitorSchema: ExperimentPublishedMonitorSchema =
  experimentPublishedMonitorSchemaDefinition;
export type ExperimentPublishedMonitor = z.infer<typeof experimentPublishedMonitorSchema>;

/** `getWorkbenchVersion`: the cheap staleness probe — the version alone. */
const experimentWorkbenchVersionProbeSchemaDefinition = z.object({
  experimentId: z.string(),
  version: z.number(),
  updatedAt: z.date(),
  ...workbenchAttributionShape,
});
export interface ExperimentWorkbenchVersionProbeSchema extends Named<
  typeof experimentWorkbenchVersionProbeSchemaDefinition
> {}
export const experimentWorkbenchVersionProbeSchema: ExperimentWorkbenchVersionProbeSchema =
  experimentWorkbenchVersionProbeSchemaDefinition;

/**
 * `saveEvaluationsV3`: the saved experiment, carrying the version THIS write
 * landed on rather than the counter the row happened to hold.
 */
const experimentSavedWorkbenchSchemaDefinition = z.object({
  ...experimentSchema.shape,
  version: z.number(),
});
export interface ExperimentSavedWorkbenchSchema extends Named<
  typeof experimentSavedWorkbenchSchemaDefinition
> {}
export const experimentSavedWorkbenchSchema: ExperimentSavedWorkbenchSchema =
  experimentSavedWorkbenchSchemaDefinition;

/** `listWorkbenchVersions`: the history drawer, with each author's name resolved. */
const experimentWorkbenchVersionsPageSchemaDefinition = z.object({
  versions: z.array(
    z.object({ ...workbenchVersionSummarySchema.shape, authorName: z.string().nullable() }),
  ),
  nextCursor: z.number().nullable(),
});
export interface ExperimentWorkbenchVersionsPageSchema extends Named<
  typeof experimentWorkbenchVersionsPageSchemaDefinition
> {}
export const experimentWorkbenchVersionsPageSchema: ExperimentWorkbenchVersionsPageSchema =
  experimentWorkbenchVersionsPageSchemaDefinition;

/** `getExperimentWithDSLBySlug`: one experiment plus the workflow behind it. */
const experimentWithDslSchemaDefinition = z.object({
  ...experimentSchema.shape,
  /** Optional as well as nullable: a row with no state reads back undefined. */
  workbenchState: z.json().nullable().optional(),
  dsl: studioWorkflowSchema.optional(),
});
export interface ExperimentWithDslSchema extends Named<typeof experimentWithDslSchemaDefinition> {}
export const experimentWithDslSchema: ExperimentWithDslSchema = experimentWithDslSchemaDefinition;

/** `getAllForEvaluationsList`: one page of the evaluations list. */
const experimentEvaluationsListPageSchemaDefinition = z.object({
  experiments: z.array(
    z.object({
      ...experimentSchema.shape,
      workbenchState: z.json().nullable().optional(),
      workflow: workflowWithVersionSchema.nullable(),
      runsSummary: z.object({
        count: z.number(),
        primaryMetric: z.unknown().optional(),
        latestRun: z.object({ timestamps: z.unknown().optional() }),
      }),
      dataset: z.object({ id: z.string(), name: z.string() }).optional(),
      /** The latest run's start, or the experiment's own update, in epoch ms. */
      updatedAt: z.number(),
    }),
  ),
  totalHits: z.number(),
});
export interface ExperimentEvaluationsListPageSchema extends Named<
  typeof experimentEvaluationsListPageSchemaDefinition
> {}
export const experimentEvaluationsListPageSchema: ExperimentEvaluationsListPageSchema =
  experimentEvaluationsListPageSchemaDefinition;
export type ExperimentEvaluationsListPage = z.infer<typeof experimentEvaluationsListPageSchema>;

/** `getExperimentBatchEvaluationRuns`: every run of one experiment. */
const experimentRunListSchemaDefinition = z.object({ runs: z.array(experimentRunSchema) });
export interface ExperimentRunListSchema extends Named<typeof experimentRunListSchemaDefinition> {}
export const experimentRunListSchema: ExperimentRunListSchema = experimentRunListSchemaDefinition;

/** `deleteExperiment`: the archive, and its cascade, took effect. */
const experimentArchivedSchemaDefinition = z.object({ success: z.literal(true) });
export interface ExperimentArchivedSchema extends Named<
  typeof experimentArchivedSchemaDefinition
> {}
export const experimentArchivedSchema: ExperimentArchivedSchema =
  experimentArchivedSchemaDefinition;

/**
 * `copy`: the new experiment and the workflow it writes versions into. A V3
 * experiment has no workflow, so `null` is the ordinary answer there.
 */
const experimentCopiedSchemaDefinition = z.object({
  experiment: experimentSchema,
  workflow: z.object({ id: z.string() }).nullable(),
});
export interface ExperimentCopiedSchema extends Named<typeof experimentCopiedSchemaDefinition> {}
export const experimentCopiedSchema: ExperimentCopiedSchema = experimentCopiedSchemaDefinition;
export type ExperimentCopied = z.infer<typeof experimentCopiedSchema>;

/** `onExperimentUpdate`: one freshness signal as the browser receives it. */
const experimentUpdateFrameSchemaDefinition = z.object({
  event: z.unknown(),
  timestamp: z.number().optional(),
});
export interface ExperimentUpdateFrameSchema extends Named<
  typeof experimentUpdateFrameSchemaDefinition
> {}
export const experimentUpdateFrameSchema: ExperimentUpdateFrameSchema =
  experimentUpdateFrameSchemaDefinition;
export type ExperimentUpdateFrame = z.infer<typeof experimentUpdateFrameSchema>;
