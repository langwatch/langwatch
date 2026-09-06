/**
 * What the experiment feature's tRPC transport answers, stated once: each
 * procedure declares its `withOutput` from here, so the shape a client reads
 * is written down rather than implied by whatever a handler returned.
 */
import { z } from "zod";
import { studioWorkflowSchema, workflowWithVersionSchema } from "@langwatch/workflow-contract";
import { experimentSchema } from "./experiment";
import { experimentRunSchema } from "./experiment-run";
import {
  workbenchActorLabelSchema,
  workbenchVersionSummarySchema,
} from "./experiment-workbench-version";
import { persistedEvaluationsV3StateSchema } from "./experiment-workbench-persistence";

/**
 * Who last wrote the version a probing tab is comparing against, and the run
 * that wrote it. Both absent on a workbench nothing has claimed.
 */
const workbenchAttributionShape = {
  actorLabel: workbenchActorLabelSchema.optional(),
  runId: z.string().optional(),
} as const;

/** `getEvaluationsV3BySlug`: the workbench state a page opens on. */
export const experimentWorkbenchPageSchema = z.object({
  id: z.string(),
  slug: z.string(),
  workbenchState: persistedEvaluationsV3StateSchema.nullable(),
  version: z.number(),
  updatedAt: z.date(),
  ...workbenchAttributionShape,
});

/** `getWorkbenchVersion`: the cheap staleness probe — the version alone. */
export const experimentWorkbenchVersionProbeSchema = z.object({
  experimentId: z.string(),
  version: z.number(),
  updatedAt: z.date(),
  ...workbenchAttributionShape,
});

/**
 * `saveEvaluationsV3`: the saved experiment, carrying the version THIS write
 * landed on rather than the counter the row happened to hold.
 */
export const experimentSavedWorkbenchSchema = experimentSchema.extend({
  version: z.number(),
});

/** `listWorkbenchVersions`: the history drawer, with each author's name resolved. */
export const experimentWorkbenchVersionsPageSchema = z.object({
  versions: z.array(workbenchVersionSummarySchema.extend({ authorName: z.string().nullable() })),
  nextCursor: z.number().nullable(),
});

/** `getExperimentWithDSLBySlug`: one experiment plus the workflow behind it. */
export const experimentWithDslSchema = experimentSchema.extend({
  /** Optional as well as nullable: a row with no state reads back undefined. */
  workbenchState: z.json().nullable().optional(),
  dsl: studioWorkflowSchema.optional(),
});

/** `getAllForEvaluationsList`: one page of the evaluations list. */
export const experimentEvaluationsListPageSchema = z.object({
  experiments: z.array(
    experimentSchema.extend({
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

/** `getExperimentBatchEvaluationRuns`: every run of one experiment. */
export const experimentRunListSchema = z.object({ runs: z.array(experimentRunSchema) });

/** `deleteExperiment`: the archive, and its cascade, took effect. */
export const experimentArchivedSchema = z.object({ success: z.literal(true) });

/**
 * `copy`: the new experiment and the workflow it writes versions into. A V3
 * experiment has no workflow, so `null` is the ordinary answer there.
 */
export const experimentCopiedSchema = z.object({
  experiment: experimentSchema,
  workflow: z.object({ id: z.string() }).nullable(),
});

/** `onExperimentUpdate`: one freshness signal as the browser receives it. */
export const experimentUpdateFrameSchema = z.object({
  event: z.unknown(),
  timestamp: z.number().optional(),
});
