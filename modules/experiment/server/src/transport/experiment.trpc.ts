/**
 * The server half of `experiments.*`. Transport only: the declared permission,
 * error translation, and delegation to the application. Everything a handler
 * reaches - the studio writes, the monitor publication, the author names, the
 * second project a copy reads - is an operation on the api, so no process
 * hands this file a collaborator of its own.
 *
 * Spec: modules/experiment/specs/experiment-service.feature.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import type { Dataset } from "@langwatch/dataset-contract";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import {
  ExperimentApi,
  ExperimentDspyStepNotFoundError,
  experimentsTrpc,
  isLegacyOnlineEvaluationWorkbenchState,
  type DSPyStep,
  type SaveExperimentInput,
} from "@langwatch/experiment-contract";
import {
  parseStudioWorkflow,
  studioWorkflowSchema,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

/**
 * Maps experiment domain errors to `TRPCError` using the code discriminant.
 * Only the two that have to change shape are listed; every other handled error
 * travels on unchanged, keeping its code and meta intact.
 */
const mapExperimentError = (error: unknown): never => {
  if (HandledError.isHandled(error) && error.code === "experiment_not_found") {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (HandledError.isHandled(error) && error.code === "experiment_type_mismatch") {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
};

/** The dataset a workflow's entry node draws from, when it names one. */
const datasetIdOf = (dsl: unknown): string | undefined => {
  const parsed = studioWorkflowSchema.safeParse(dsl);
  if (!parsed.success) return undefined;
  const entry = parsed.data.nodes.find((node) => node.type === "entry");

  return (entry?.data as { dataset?: { id?: string } } | undefined)?.dataset?.id;
};

/** The most recently created run in a list, or undefined for an empty list. */
function latestRunOf<T extends { timestamps: { createdAt: number } }>(
  runs: readonly T[],
): T | undefined {
  return runs.slice().sort((a, b) => b.timestamps.createdAt - a.timestamps.createdAt)[0];
}

/**
 * Copies an EVALUATIONS_V3 experiment to another project: the state in
 * `workbenchState` plus, optionally, the saved datasets it references.
 */
const copyEvaluationsV3Experiment = async ({
  app,
  experiment,
  targetProjectId,
  sourceProjectId,
  copyDatasets,
}: {
  app: ExperimentApi;
  experiment: Readonly<{
    id: string;
    name: string | null;
    slug: string;
    workbenchState: unknown;
  }>;
  targetProjectId: string;
  sourceProjectId: string;
  copyDatasets?: boolean;
}) => {
  const workbenchState = JSON.parse(JSON.stringify(experiment.workbenchState ?? {})) as Record<
    string,
    unknown
  >;

  // Execution results are not copied into the new project.
  delete workbenchState.results;

  if (copyDatasets && Array.isArray(workbenchState.datasets)) {
    const datasetIdMap: Record<string, string> = {};

    for (const entry of workbenchState.datasets as Array<{
      id: string;
      type: string;
      datasetId?: string;
    }>) {
      if (entry.type === "saved" && entry.datasetId) {
        try {
          const newDataset = await app.copyDataset({
            sourceDatasetId: entry.datasetId,
            sourceProjectId,
            targetProjectId,
          });
          datasetIdMap[entry.datasetId] = newDataset.id;
        } catch {
          // A dataset that cannot be copied (for example one already removed)
          // keeps its original reference rather than failing the whole copy.
          continue;
        }
      }
    }

    for (const entry of workbenchState.datasets as Array<{
      id: string;
      type: string;
      datasetId?: string;
    }>) {
      const mapped = entry.datasetId ? datasetIdMap[entry.datasetId] : undefined;
      if (entry.type === "saved" && mapped) {
        entry.datasetId = mapped;
      }
    }
  }

  const experimentName = experiment.name ?? experiment.slug;
  const newExperiment = await app.save({
    id: generate("eval").toString(),
    name: experimentName,
    requestedSlug: app.slugFor(experimentName),
    slugMode: "deduplicate",
    projectId: targetProjectId,
    type: "EVALUATIONS_V3",
    workflowId: null,
    workbenchState: z.json().parse(workbenchState),
  });

  return { experiment: newExperiment, workflow: null };
};

/** The workbench state the legacy wizard stored, as this transport reads it. */
type LegacyWorkbenchState = Readonly<{
  name?: string | null;
  realTimeExecution?: { preconditions?: unknown; sample?: number };
  realTimeTraceMappings?: unknown;
}>;

export const experimentTrpcTransport = defineTrpcRouter(ExperimentApi, experimentsTrpc)
  // ── The workbench a tab has open ─────────────────────────────────

  .procedure("saveExperiment")
  .withPermission("workflows:create")
  .handle(async ({ app, input }) => {
    const state = input.workbenchState as LegacyWorkbenchState;

    let workflowId = input.dsl.workflow_id;
    const name = state.name ?? (await app.findNextDraftName({ projectId: input.projectId }));

    if (input.experimentId) {
      const currentExperiment = await app
        .getById({ projectId: input.projectId, id: input.experimentId })
        .catch(mapExperimentError);

      if (currentExperiment.workflowId) {
        const workflow = await app.findWorkflow({
          id: currentExperiment.workflowId,
          projectId: input.projectId,
        });

        if (!workflow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Workflow not found" });
        }

        workflowId = workflow.id;
      }

      // Rename the experiment's datasets alongside it, so a renamed experiment
      // does not leave its datasets pointing at the old name.
      if (currentExperiment.name && currentExperiment.name !== name) {
        const datasetIds = input.dsl.nodes
          .filter((node) => node.type === "dataset")
          .map((node) => (node.data as { dataset?: { id?: string } }).dataset?.id)
          .filter((id): id is string => !!id);

        const datasets = await app.getDatasets({ datasetIds, projectId: input.projectId });

        for (const dataset of datasets) {
          if (dataset.name.startsWith(currentExperiment.name)) {
            await app.renameDataset({
              datasetId: dataset.id,
              projectId: input.projectId,
              name: dataset.name.replace(currentExperiment.name, name),
            });
          }
        }
      }
    }

    const workflowName = `${name} - Workflow`;
    if (!workflowId) {
      const workflow = await app.createWorkflow({
        projectId: input.projectId,
        name: workflowName,
        icon: input.dsl.icon,
        description: input.dsl.description,
      });

      workflowId = workflow.id;
    }

    await app.saveWorkflowVersion({
      projectId: input.projectId,
      workflowId,
      dsl: { ...input.dsl, workflow_id: workflowId, name: workflowName },
      autoSaved: !input.commitMessage,
      commitMessage: input.commitMessage ?? "Autosaved",
      setAsLatestVersion: true,
    });

    const experimentId = input.experimentId ?? generate("experiment").toString();

    return app
      .save({
        id: experimentId,
        projectId: input.projectId,
        name,
        type: "BATCH_EVALUATION_V2",
        requestedSlug: app.slugFor(name),
        slugMode: input.experimentId ? "preserve-existing" : "deduplicate",
        workflowId,
        // The stored state is whatever the declaration admitted, which is JSON
        // by construction; the service stores it verbatim.
        workbenchState: input.workbenchState as SaveExperimentInput["workbenchState"],
      })
      .catch(mapExperimentError);
  })

  .procedure("saveEvaluationsV3")
  .withPermission("experiments:update")
  .handle(async ({ app, input, actor }) => {
    const experimentId = input.experimentId ?? generate("experiment").toString();

    const saved = await app
      .saveWorkbenchState(
        {
          projectId: input.projectId,
          id: experimentId,
          state: input.state,
          ...(input.expectedVersion === undefined
            ? {}
            : { expectedVersion: input.expectedVersion }),
        },
        { kind: "user", id: actor.id },
      )
      .catch(mapExperimentError);
    const updatedExperiment = await app
      .getById({ projectId: input.projectId, id: saved.experimentId })
      .catch(mapExperimentError);

    // The row does not carry the version this save landed on - the counter it
    // holds is whatever the last read saw. Autosave compares the version its
    // own write produced against the staleness a concurrent broadcast may
    // already have raised, so the save result's version rides along.
    return { ...updatedExperiment, version: saved.version };
  })

  .procedure("getEvaluationsV3BySlug")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const [experiment, workbenchState] = await Promise.all([
      app
        .getBySlug({ projectId: input.projectId, slug: input.experimentSlug })
        .catch(mapExperimentError),
      app
        .getWorkbenchState({ projectId: input.projectId, slug: input.experimentSlug })
        .catch(mapExperimentError),
    ]);

    return {
      ...experiment,
      workbenchState: workbenchState.state,
      version: workbenchState.version,
      updatedAt: workbenchState.updatedAt,
      ...(workbenchState.actorLabel !== undefined
        ? { actorLabel: workbenchState.actorLabel }
        : {}),
      ...(workbenchState.runId !== undefined ? { runId: workbenchState.runId } : {}),
    };
  })

  .procedure("getWorkbenchVersion")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const workbenchState = await app
      .getWorkbenchState({ projectId: input.projectId, slug: input.experimentSlug })
      .catch(mapExperimentError);

    return {
      experimentId: workbenchState.experimentId,
      version: workbenchState.version,
      updatedAt: workbenchState.updatedAt,
      // Who wrote the version the probing tab is comparing against. A tab that
      // has to tell its reader their work is out of date owes them the name.
      ...(workbenchState.actorLabel !== undefined
        ? { actorLabel: workbenchState.actorLabel }
        : {}),
      // The run that wrote it, when a run did. A tab coming back from the
      // background adopts a version its own run wrote rather than standing
      // down over a write it already holds every cell of.
      ...(workbenchState.runId !== undefined ? { runId: workbenchState.runId } : {}),
    };
  })

  .procedure("onExperimentUpdate")
  .withPermission("experiments:view")
  .handle(({ app, input, signal }) =>
    app.watchUpdates({ projectId: input.projectId, signal }),
  )

  .procedure("listWorkbenchVersions")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const page = await app
      .listWorkbenchVersions({
        projectId: input.projectId,
        id: input.experimentId,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      })
      .catch(mapExperimentError);

    // The history names the person who saved each version, and the service
    // stores only their id.
    const authorIds = [
      ...new Set(
        page.versions.map((version) => version.authorId).filter((id): id is string => !!id),
      ),
    ];
    const authors = await app.resolveAuthorNames(authorIds);
    const nameById = new Map(authors.map((author) => [author.id, author.name]));

    return {
      ...page,
      versions: page.versions.map((version) => ({
        ...version,
        authorName: version.authorId ? (nameById.get(version.authorId) ?? null) : null,
      })),
    };
  })

  .procedure("commitWorkbenchVersion")
  .withPermission("experiments:update")
  .handle(({ app, input, actor }) =>
    app
      .commitWorkbenchVersion(
        {
          projectId: input.projectId,
          id: input.experimentId,
          commitMessage: input.commitMessage,
        },
        { kind: "user", id: actor.id },
      )
      .catch(mapExperimentError),
  )

  .procedure("restoreWorkbenchVersion")
  .withPermission("experiments:update")
  .handle(({ app, input, actor }) =>
    app
      .restoreWorkbenchVersion(
        { projectId: input.projectId, id: input.experimentId, version: input.version },
        { kind: "user", id: actor.id },
      )
      .catch(mapExperimentError),
  )

  .procedure("saveAsMonitor")
  .withPermission("workflows:create")
  .handle(async ({ app, input }) => {
    const experiment = await app
      .getById({ projectId: input.projectId, id: input.experimentId })
      .catch(mapExperimentError);
    const workflow = experiment.workflowId
      ? await app.findWorkflow({
          id: experiment.workflowId,
          projectId: input.projectId,
          includeVersion: true,
        })
      : null;

    const workbenchState = experiment.workbenchState as LegacyWorkbenchState | undefined;
    const dsl = workflow?.currentVersion?.dsl as StudioWorkflow | undefined;
    const evaluator = dsl?.nodes.find((node) => node.type === "evaluator");
    const evaluatorData = evaluator?.data as
      | { evaluator?: string; parameters?: ReadonlyArray<{ identifier: string; value: unknown }> }
      | undefined;

    if (!workbenchState || !dsl || !evaluatorData?.evaluator) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Experiment is not ready to be saved as a monitor",
      });
    }

    return app.publishAsMonitor({
      projectId: input.projectId,
      experimentId: input.experimentId,
      monitor: {
        name: experiment.name ?? "Unknown",
        checkType: evaluatorData.evaluator,
        slug: experiment.slug,
        preconditions: workbenchState.realTimeExecution?.preconditions ?? [],
        parameters: Object.fromEntries(
          (evaluatorData.parameters ?? []).map((param) => [param.identifier, param.value]),
        ),
        mappings: workbenchState.realTimeTraceMappings,
        sample: workbenchState.realTimeExecution?.sample ?? 1,
        enabled: true,
        executionMode: "ON_MESSAGE",
      },
    });
  })

  // ── The experiments a project lists ──────────────────────────────

  .procedure("getExperimentBySlugOrId")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    if (input.experimentId) {
      return await app
        .getById({ projectId: input.projectId, id: input.experimentId })
        .catch(mapExperimentError);
    }
    if (input.experimentSlug) {
      return await app
        .getBySlug({ projectId: input.projectId, slug: input.experimentSlug })
        .catch(mapExperimentError);
    }

    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Either experimentId or experimentSlug must be provided",
    });
  })

  .procedure("getExperimentWithDSLBySlug")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const experiment = await app
      .getBySlug({ projectId: input.projectId, slug: input.experimentSlug })
      .catch(mapExperimentError);

    const workflow = experiment.workflowId
      ? await app.findWorkflow({
          id: experiment.workflowId,
          projectId: input.projectId,
          includeVersion: true,
        })
      : undefined;

    return {
      ...experiment,
      dsl: workflow?.currentVersion?.dsl
        ? parseStudioWorkflow(workflow.currentVersion.dsl)
        : undefined,
    };
  })

  .procedure("getAllByProjectId")
  .withPermission("experiments:view")
  .handle(({ app, input }) => app.list({ projectId: input.projectId }))

  .procedure("getAllForEvaluationsList")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const pageOffset = input.pageOffset ?? 0;
    const pageSize = input.pageSize ?? 25;

    // Every active experiment with its workflow join, then filter and paginate
    // in memory: JSON-path filtering on `task` inside `workbenchState` is
    // unreliable, so the count and the page slice run off the same array.
    const allExperiments = await Promise.all(
      (await app.list({ projectId: input.projectId })).map(async (experiment) => ({
        ...experiment,
        workflow: experiment.workflowId
          ? await app.findWorkflow({
              id: experiment.workflowId,
              projectId: input.projectId,
              includeVersion: true,
            })
          : null,
      })),
    );
    const nonLegacyExperiments = allExperiments.filter(
      (experiment) => !isLegacyOnlineEvaluationWorkbenchState(experiment.workbenchState),
    );
    const totalHits = nonLegacyExperiments.length;

    // Pagination is applied after excluding legacy online evaluations.
    const pagedExperiments = nonLegacyExperiments.slice(pageOffset, pageOffset + pageSize);

    const datasetIds = pagedExperiments
      .map((experiment) => datasetIdOf(experiment.workflow?.currentVersion?.dsl))
      .filter((id): id is string => !!id);

    const datasetsById = Object.fromEntries(
      (await app.getDatasets({ projectId: input.projectId, datasetIds })).map(
        (dataset: Dataset) => [dataset.id, { id: dataset.id, name: dataset.name }],
      ),
    );

    const runsByExperimentId = await app.listRuns({
      projectId: input.projectId,
      experimentIds: pagedExperiments.map((experiment) => experiment.id),
    });

    const experimentsWithDatasetsAndRuns = pagedExperiments
      .map((experiment) => {
        const runs = runsByExperimentId[experiment.id] ?? [];
        const latestRun = latestRunOf(runs);
        const primaryMetric = latestRun
          ? Object.values(latestRun.summary.evaluations)[0]
          : undefined;

        return {
          ...experiment,
          runsSummary: {
            count: runs.length,
            primaryMetric,
            latestRun: { timestamps: latestRun?.timestamps },
          },
          dataset: datasetsById[datasetIdOf(experiment.workflow?.currentVersion?.dsl) ?? ""],
          updatedAt: latestRun?.timestamps.createdAt ?? experiment.updatedAt.getTime(),
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return { experiments: experimentsWithDatasetsAndRuns, totalHits };
  })

  .procedure("getLastExperiment")
  .withPermission("experiments:view")
  .handle(({ app, input }) => app.findLatest({ projectId: input.projectId }))

  .procedure("deleteExperiment")
  .withPermission("workflows:delete")
  .handle(({ app, input }) =>
    // The cascade - the workflow the experiment wrote versions into, and the
    // monitor it was published as - is one act, and it is the application's. A
    // second door sequencing the same three writes is a second chance to
    // sequence them differently.
    app
      .archive({ projectId: input.projectId, id: input.experimentId })
      .catch(mapExperimentError),
  )

  .procedure("copy")
  .withPermission("evaluations:manage")
  .handle(async ({ app, input, actor }) => {
    // The declared check covers the TARGET project. The source is a second
    // project it never saw, so it is probed before anything is read.
    const mayReadSource = await app.mayManageEvaluations({
      actorId: actor.id,
      projectId: input.sourceProjectId,
    });

    if (!mayReadSource) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You do not have permission to manage evaluations in the source project",
      });
    }

    const experiment = await app
      .getById({ projectId: input.sourceProjectId, id: input.experimentId })
      .catch(mapExperimentError);

    // V3 experiments have no workflow; their state lives in workbenchState.
    if (experiment.type === "EVALUATIONS_V3") {
      return await copyEvaluationsV3Experiment({
        app,
        experiment,
        targetProjectId: input.projectId,
        sourceProjectId: input.sourceProjectId,
        ...(input.copyDatasets === undefined ? {} : { copyDatasets: input.copyDatasets }),
      });
    }

    if (!experiment.workflowId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Experiment workflow not found" });
    }
    const sourceWorkflow = await app.findWorkflow({
      id: experiment.workflowId,
      projectId: input.sourceProjectId,
      includeVersion: true,
    });
    if (!sourceWorkflow?.latestVersion?.dsl) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Experiment workflow not found" });
    }

    const { workflowId, dsl } = await app.copyWorkflowWithDatasets({
      workflow: {
        id: sourceWorkflow.id,
        name: sourceWorkflow.name,
        icon: sourceWorkflow.icon,
        description: sourceWorkflow.description,
        ...(sourceWorkflow.isEvaluator === undefined
          ? {}
          : { isEvaluator: sourceWorkflow.isEvaluator }),
        ...(sourceWorkflow.isComponent === undefined
          ? {}
          : { isComponent: sourceWorkflow.isComponent }),
        latestVersion: {
          ...sourceWorkflow.latestVersion,
          dsl: z.json().parse(sourceWorkflow.latestVersion.dsl),
        },
      },
      targetProjectId: input.projectId,
      sourceProjectId: input.sourceProjectId,
      ...(input.copyDatasets === undefined ? {} : { copyDatasets: input.copyDatasets }),
      copiedFromWorkflowId: experiment.workflowId,
    });

    const newWorkflow = await app.findWorkflow({ id: workflowId, projectId: input.projectId });

    if (!newWorkflow) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create workflow",
      });
    }

    await app.saveWorkflowVersion({
      projectId: input.projectId,
      workflowId,
      dsl,
      autoSaved: false,
      commitMessage: `Copied from ${sourceWorkflow.name}`,
    });

    const experimentName = experiment.name ?? experiment.slug;
    const newExperiment = await app.save({
      id: generate("experiment").toString(),
      name: experimentName,
      requestedSlug: app.slugFor(experimentName),
      slugMode: "deduplicate",
      projectId: input.projectId,
      type: experiment.type,
      workflowId,
      workbenchState: experiment.workbenchState,
    });

    return { experiment: newExperiment, workflow: { id: newWorkflow.id } };
  })

  // ── The runs recorded against one ────────────────────────────────

  .procedure("getExperimentDSPyRuns")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const experiment = await app
      .getBySlug({ projectId: input.projectId, slug: input.experimentSlug })
      .catch(mapExperimentError);

    return app.listDspyRuns({ tenantId: input.projectId, experimentId: experiment.id });
  })

  .procedure("getExperimentDSPyStep")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const experiment = await app
      .getBySlug({ projectId: input.projectId, slug: input.experimentSlug })
      .catch(mapExperimentError);

    try {
      const step = await app.getDspyStep({
        tenantId: input.projectId,
        experimentId: experiment.id,
        runId: input.runId,
        stepIndex: input.index,
      });

      // The domain type is camelCase; the page reads the snake_case wire shape
      // the optimization studio has always published.
      const result: DSPyStep = {
        project_id: step.tenantId,
        run_id: step.runId,
        workflow_version_id: step.workflowVersionId,
        experiment_id: step.experimentId,
        index: step.stepIndex,
        score: step.score,
        label: step.label,
        optimizer: {
          name: step.optimizerName,
          parameters: step.optimizerParameters as DSPyStep["optimizer"]["parameters"],
        },
        predictors: step.predictors as DSPyStep["predictors"],
        examples: step.examples as DSPyStep["examples"],
        llm_calls: step.llmCalls as DSPyStep["llm_calls"],
        timestamps: {
          created_at: step.createdAt,
          inserted_at: step.insertedAt,
          updated_at: step.updatedAt,
        },
      };

      return result;
    } catch (error) {
      if (error instanceof ExperimentDspyStepNotFoundError) {
        throw new TRPCError({ code: "NOT_FOUND", message: "DSPy step not found" });
      }
      throw error;
    }
  })

  .procedure("getExperimentBatchEvaluationRuns")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const experiment = await app
      .getById({ projectId: input.projectId, id: input.experimentId })
      .catch(mapExperimentError);

    const runsByExperimentId = await app.listRuns({
      projectId: input.projectId,
      experimentIds: [experiment.id],
    });

    return { runs: runsByExperimentId[experiment.id] ?? [] };
  })

  .procedure("getExperimentBatchEvaluationRun")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const experiment = await app
      .getById({ projectId: input.projectId, id: input.experimentId })
      .catch(mapExperimentError);

    return app.findRun({
      projectId: input.projectId,
      experimentId: experiment.id,
      runId: input.runId,
    });
  })

  .build();
