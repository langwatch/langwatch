// Every `experiments.*` procedure in three groups: workbench, project list,
// and runs. Legacy wizard setup stored as open record, verbatim.

import { defineTrpcContract } from "@langwatch/api/contract";
import { studioWorkflowSchema } from "@langwatch/workflow-contract";
import { z } from "zod";

import { dSPyRunsSummarySchema, dSPyStepSchema } from "./experiment-legacy.ts";
import { experimentRunWithItemsSchema } from "./experiment-run.ts";
import { persistedEvaluationsV3StateSchema } from "./experiment-workbench-persistence.ts";
import { workbenchSaveResultSchema } from "./experiment-workbench-version.ts";
import {
  experimentArchivedSchema,
  experimentCopiedSchema,
  experimentEvaluationsListPageSchema,
  experimentPublishedMonitorSchema,
  experimentRunListSchema,
  experimentSavedWorkbenchSchema,
  experimentUpdateFrameSchema,
  experimentWithDslSchema,
  experimentWorkbenchPageSchema,
  experimentWorkbenchVersionProbeSchema,
  experimentWorkbenchVersionsPageSchema,
} from "./experiment.responses.ts";
import { experimentSchema } from "./experiment.ts";

/** Every procedure here is asked at one project, named by the input. */
const projectScopeSchema = z.object({ projectId: z.string() });

/**
 * The legacy wizard's stored setup, as the wire carries it. Open on purpose:
 * its vocabulary is the deployment's evaluation preconditions and trace
 * mappings, which this module does not own and stores without reading.
 */
export const legacyWorkbenchStateSchema = z
  .record(z.string(), z.unknown())
  .describe("The wizard's stored setup: read it, change it, send it back whole.");

/** `saveExperiment`: the legacy wizard's setup and the graph it writes a version of. */
export const experimentWizardSaveInputSchema = z.object({
  ...projectScopeSchema.shape,
  experimentId: z.string().optional(),
  workbenchState: legacyWorkbenchStateSchema,
  dsl: studioWorkflowSchema,
  commitMessage: z.string().optional(),
});
export type ExperimentWizardSaveInput = z.infer<typeof experimentWizardSaveInputSchema>;

/** `getExperimentBySlugOrId`: one experiment, named by either key. */
export const experimentIdOrSlugInputSchema = z.object({
  ...projectScopeSchema.shape,
  experimentId: z.string().optional(),
  experimentSlug: z.string().optional(),
});
export type ExperimentIdOrSlugInput = z.infer<typeof experimentIdOrSlugInputSchema>;

/** `getAllForEvaluationsList`: which page of the evaluations list. */
export const experimentEvaluationsListInputSchema = z.object({
  ...projectScopeSchema.shape,
  pageOffset: z.number().optional(),
  pageSize: z.number().optional(),
});
export type ExperimentEvaluationsListInput = z.infer<typeof experimentEvaluationsListInputSchema>;

/** `copy`: an experiment from a source project into the target project. */
export const experimentCopyInputSchema = z.object({
  experimentId: z.string(),
  projectId: z.string(),
  sourceProjectId: z.string(),
  copyDatasets: z.boolean().optional(),
});
export type ExperimentCopyInput = z.infer<typeof experimentCopyInputSchema>;

export const experimentsTrpc = defineTrpcContract("experiments")
  // ── The workbench a tab has open ─────────────────────────────────

  .mutation("saveExperiment")
  .withInput(experimentWizardSaveInputSchema)
  .withOutput(experimentSchema)

  /**
   * `expectedVersion` turns the save into a compare-and-set, refusing a save
   * on top of someone else's newer state; omitted means last-write-wins.
   */
  .mutation("saveEvaluationsV3")
  .withInput(
    z.object({
      ...projectScopeSchema.shape,
      experimentId: z.string().optional(),
      state: persistedEvaluationsV3StateSchema,
      expectedVersion: z.number().int().optional(),
    }),
  )
  .withOutput(experimentSavedWorkbenchSchema)

  .query("getEvaluationsV3BySlug")
  .withInput(z.object({ ...projectScopeSchema.shape, experimentSlug: z.string() }))
  .withOutput(experimentWorkbenchPageSchema)

  /**
   * The cheap staleness probe: the version and nothing else. A returning tab
   * compares it with the version it loaded and refetches the whole state only
   * when it is behind, so tab switching costs one point read, not one blob.
   */
  .query("getWorkbenchVersion")
  .withInput(z.object({ ...projectScopeSchema.shape, experimentSlug: z.string() }))
  .withOutput(experimentWorkbenchVersionProbeSchema)

  /**
   * The signal a workbench save lands on. Signal-then-refetch: the payload
   * never carries state.
   */
  .subscription("onExperimentUpdate")
  .withInput(projectScopeSchema)
  .withOutput(experimentUpdateFrameSchema)

  .query("listWorkbenchVersions")
  .withInput(
    z.object({
      ...projectScopeSchema.shape,
      experimentId: z.string(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.number().int().optional(),
    }),
  )
  .withOutput(experimentWorkbenchVersionsPageSchema)

  .mutation("commitWorkbenchVersion")
  .withInput(
    z.object({
      ...projectScopeSchema.shape,
      experimentId: z.string(),
      commitMessage: z.string().min(1),
    }),
  )
  .withOutput(workbenchSaveResultSchema)

  .mutation("restoreWorkbenchVersion")
  .withInput(
    z.object({
      ...projectScopeSchema.shape,
      experimentId: z.string(),
      version: z.number().int().min(1),
    }),
  )
  .withOutput(workbenchSaveResultSchema)

  /** Publishes the experiment and returns the monitor row origin/main returned. */
  .mutation("saveAsMonitor")
  .withInput(z.object({ ...projectScopeSchema.shape, experimentId: z.string() }))
  .withOutput(experimentPublishedMonitorSchema)

  // ── The experiments a project lists ──────────────────────────────

  .query("getExperimentBySlugOrId")
  .withInput(experimentIdOrSlugInputSchema)
  .withOutput(experimentSchema)

  .query("getExperimentWithDSLBySlug")
  .withInput(
    z.object({
      ...projectScopeSchema.shape,
      experimentSlug: z.string(),
      randomSeed: z.number().optional(),
    }),
  )
  .withOutput(experimentWithDslSchema)

  .query("getAllByProjectId")
  .withInput(projectScopeSchema)
  .withOutput(z.array(experimentSchema))

  .query("getAllForEvaluationsList")
  .withInput(experimentEvaluationsListInputSchema)
  .withOutput(experimentEvaluationsListPageSchema)

  /** Whether the project's last experiment is still a draft. */
  .query("getLastExperiment")
  .withInput(projectScopeSchema)
  .withOutput(experimentSchema.nullable())

  /**
   * Archives an experiment, and with it the workflow it wrote versions into
   * and the monitor it was published as. The wire name stays `delete` for the
   * page that has always called it.
   */
  .mutation("deleteExperiment")
  .withInput(z.object({ ...projectScopeSchema.shape, experimentId: z.string() }))
  .withOutput(experimentArchivedSchema)

  .mutation("copy")
  .withInput(experimentCopyInputSchema)
  .withOutput(experimentCopiedSchema)

  // ── The runs recorded against one ────────────────────────────────

  .query("getExperimentDSPyRuns")
  .withInput(z.object({ ...projectScopeSchema.shape, experimentSlug: z.string() }))
  .withOutput(z.array(dSPyRunsSummarySchema))

  .query("getExperimentDSPyStep")
  .withInput(
    z.object({
      ...projectScopeSchema.shape,
      experimentSlug: z.string(),
      runId: z.string(),
      index: z.string(),
    }),
  )
  .withOutput(dSPyStepSchema)

  .query("getExperimentBatchEvaluationRuns")
  .withInput(z.object({ ...projectScopeSchema.shape, experimentId: z.string() }))
  .withOutput(experimentRunListSchema)

  .query("getExperimentBatchEvaluationRun")
  .withInput(z.object({ ...projectScopeSchema.shape, experimentId: z.string(), runId: z.string() }))
  .withOutput(experimentRunWithItemsSchema.nullable())

  .build();
