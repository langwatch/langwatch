/**
 * Every `experiments.*` procedure, declared once. Twenty of them, in the three
 * groups the pages are laid out in: the workbench a tab has open, the
 * experiments a project lists, and the runs recorded against one.
 *
 * The legacy wizard's stored setup is declared here as the open record the
 * REST family already publishes rather than as the host's own wizard schema.
 * A contract carries no process generic, and the setup is stored verbatim: the
 * only field any handler reads out of it is `name`.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { studioWorkflowSchema } from "@langwatch/workflow-contract";
import { z } from "zod";

import { dSPyRunsSummarySchema, dSPyStepSchema } from "./experiment-legacy.ts";
import { experimentRunWithItemsSchema } from "./experiment-run.ts";
import { persistedEvaluationsV3StateSchema } from "./experiment-workbench-persistence.ts";
import { workbenchSaveResultSchema } from "./experiment-workbench-version.ts";
import { experimentSchema } from "./experiment.ts";
import {
  experimentArchivedSchema,
  experimentCopiedSchema,
  experimentEvaluationsListPageSchema,
  experimentRunListSchema,
  experimentSavedWorkbenchSchema,
  experimentUpdateFrameSchema,
  experimentWithDslSchema,
  experimentWorkbenchPageSchema,
  experimentWorkbenchVersionProbeSchema,
  experimentWorkbenchVersionsPageSchema,
} from "./experiment.responses.ts";

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

export const experimentsTrpc = defineTrpcContract("experiments")
  // ── The workbench a tab has open ─────────────────────────────────

  .mutation("saveExperiment")
  .withInput(
    projectScopeSchema.extend({
      experimentId: z.string().optional(),
      workbenchState: legacyWorkbenchStateSchema,
      dsl: studioWorkflowSchema,
      commitMessage: z.string().optional(),
    }),
  )
  .withOutput(experimentSchema)

  /**
   * `expectedVersion` turns the save into a compare-and-set, refusing a save
   * on top of someone else's newer state; omitted means last-write-wins.
   */
  .mutation("saveEvaluationsV3")
  .withInput(
    projectScopeSchema.extend({
      experimentId: z.string().optional(),
      state: persistedEvaluationsV3StateSchema,
      expectedVersion: z.number().int().optional(),
    }),
  )
  .withOutput(experimentSavedWorkbenchSchema)

  .query("getEvaluationsV3BySlug")
  .withInput(projectScopeSchema.extend({ experimentSlug: z.string() }))
  .withOutput(experimentWorkbenchPageSchema)

  /**
   * The cheap staleness probe: the version and nothing else. A returning tab
   * compares it with the version it loaded and refetches the whole state only
   * when it is behind, so tab switching costs one point read, not one blob.
   */
  .query("getWorkbenchVersion")
  .withInput(projectScopeSchema.extend({ experimentSlug: z.string() }))
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
    projectScopeSchema.extend({
      experimentId: z.string(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.number().int().optional(),
    }),
  )
  .withOutput(experimentWorkbenchVersionsPageSchema)

  .mutation("commitWorkbenchVersion")
  .withInput(
    projectScopeSchema.extend({ experimentId: z.string(), commitMessage: z.string().min(1) }),
  )
  .withOutput(workbenchSaveResultSchema)

  .mutation("restoreWorkbenchVersion")
  .withInput(
    projectScopeSchema.extend({ experimentId: z.string(), version: z.number().int().min(1) }),
  )
  .withOutput(workbenchSaveResultSchema)

  /**
   * Publishes the experiment as the monitor it describes. It answers nothing:
   * the monitor row belongs to the monitor module's own vocabulary, and no
   * client reads it back.
   */
  .mutation("saveAsMonitor")
  .withInput(projectScopeSchema.extend({ experimentId: z.string() }))

  // ── The experiments a project lists ──────────────────────────────

  .query("getExperimentBySlugOrId")
  .withInput(
    projectScopeSchema.extend({
      experimentId: z.string().optional(),
      experimentSlug: z.string().optional(),
    }),
  )
  .withOutput(experimentSchema)

  .query("getExperimentWithDSLBySlug")
  .withInput(
    projectScopeSchema.extend({ experimentSlug: z.string(), randomSeed: z.number().optional() }),
  )
  .withOutput(experimentWithDslSchema)

  .query("getAllByProjectId")
  .withInput(projectScopeSchema)
  .withOutput(z.array(experimentSchema))

  .query("getAllForEvaluationsList")
  .withInput(
    projectScopeSchema.extend({
      pageOffset: z.number().optional(),
      pageSize: z.number().optional(),
    }),
  )
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
  .withInput(projectScopeSchema.extend({ experimentId: z.string() }))
  .withOutput(experimentArchivedSchema)

  .mutation("copy")
  .withInput(
    z.object({
      experimentId: z.string(),
      projectId: z.string(),
      sourceProjectId: z.string(),
      copyDatasets: z.boolean().optional(),
    }),
  )
  .withOutput(experimentCopiedSchema)

  // ── The runs recorded against one ────────────────────────────────

  .query("getExperimentDSPyRuns")
  .withInput(projectScopeSchema.extend({ experimentSlug: z.string() }))
  .withOutput(z.array(dSPyRunsSummarySchema))

  .query("getExperimentDSPyStep")
  .withInput(
    projectScopeSchema.extend({
      experimentSlug: z.string(),
      runId: z.string(),
      index: z.string(),
    }),
  )
  .withOutput(dSPyStepSchema)

  .query("getExperimentBatchEvaluationRuns")
  .withInput(projectScopeSchema.extend({ experimentId: z.string() }))
  .withOutput(experimentRunListSchema)

  .query("getExperimentBatchEvaluationRun")
  .withInput(projectScopeSchema.extend({ experimentId: z.string(), runId: z.string() }))
  .withOutput(experimentRunWithItemsSchema.nullable())

  .build();
