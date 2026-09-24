/**
 * Server transport for experiments.*: permission and delegation.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import {
  ExperimentApi,
  experimentsTrpc,
  type DSPyStep,
  type ExperimentDspyStep,
} from "@langwatch/experiment-contract";
import { generate } from "@langwatch/ksuid";
import { parseStudioWorkflow } from "@langwatch/workflow-contract";

/**
 * The domain type is camelCase; the page reads the snake_case wire shape
 * the optimization studio has always published.
 */
const toDspyStepWire = (step: ExperimentDspyStep): DSPyStep => ({
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
});

export const experimentTrpcTransport = defineTrpcRouter(ExperimentApi, experimentsTrpc)
  // ── The workbench a tab has open ─────────────────────────────────

  .procedure("saveExperiment")
  .withPermission("workflows:create")
  .handle(({ app, input }) => app.saveWithWorkflow(input))

  .procedure("saveEvaluationsV3")
  .withPermission("experiments:update")
  .handle(async ({ app, input, actor }) => {
    const experimentId = input.experimentId ?? generate("experiment").toString();

    const saved = await app.saveWorkbenchState(
      {
        projectId: input.projectId,
        id: experimentId,
        state: input.state,
        ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
      },
      { kind: "user", id: actor.id },
    );
    const updatedExperiment = await app.getById({
      projectId: input.projectId,
      id: saved.experimentId,
    });

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
      app.getBySlug({ projectId: input.projectId, slug: input.experimentSlug }),
      app.getWorkbenchState({ projectId: input.projectId, slug: input.experimentSlug }),
    ]);

    return {
      ...experiment,
      workbenchState: workbenchState.state,
      version: workbenchState.version,
      updatedAt: workbenchState.updatedAt,
      ...(workbenchState.actorLabel !== undefined ? { actorLabel: workbenchState.actorLabel } : {}),
      ...(workbenchState.runId !== undefined ? { runId: workbenchState.runId } : {}),
    };
  })

  .procedure("getWorkbenchVersion")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const workbenchState = await app.getWorkbenchState({
      projectId: input.projectId,
      slug: input.experimentSlug,
    });

    return {
      experimentId: workbenchState.experimentId,
      version: workbenchState.version,
      updatedAt: workbenchState.updatedAt,
      // Who wrote the version the probing tab is comparing against. A tab that
      // has to tell its reader their work is out of date owes them the name.
      ...(workbenchState.actorLabel !== undefined ? { actorLabel: workbenchState.actorLabel } : {}),
      // The run that wrote it, when a run did. A tab coming back from the
      // background adopts a version its own run wrote rather than standing
      // down over a write it already holds every cell of.
      ...(workbenchState.runId !== undefined ? { runId: workbenchState.runId } : {}),
    };
  })

  .procedure("onExperimentUpdate")
  .withPermission("experiments:view")
  .handle(({ app, input, signal }) => app.watchUpdates({ projectId: input.projectId, signal }))

  .procedure("listWorkbenchVersions")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const page = await app.listWorkbenchVersions({
      projectId: input.projectId,
      id: input.experimentId,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    });

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
    app.commitWorkbenchVersion(
      {
        projectId: input.projectId,
        id: input.experimentId,
        commitMessage: input.commitMessage,
      },
      { kind: "user", id: actor.id },
    ),
  )

  .procedure("restoreWorkbenchVersion")
  .withPermission("experiments:update")
  .handle(({ app, input, actor }) =>
    app.restoreWorkbenchVersion(
      { projectId: input.projectId, id: input.experimentId, version: input.version },
      { kind: "user", id: actor.id },
    ),
  )

  .procedure("saveAsMonitor")
  .withPermission("workflows:create")
  .handle(({ app, input }) => app.saveAsMonitor(input))

  // ── The experiments a project lists ──────────────────────────────

  .procedure("getExperimentBySlugOrId")
  .withPermission("experiments:view")
  .handle(({ app, input }) => app.getByIdOrSlug(input))

  .procedure("getExperimentWithDSLBySlug")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const experiment = await app.getBySlug({
      projectId: input.projectId,
      slug: input.experimentSlug,
    });

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
  .handle(({ app, input }) => app.listForEvaluations(input))

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
    app.archive({ projectId: input.projectId, id: input.experimentId }),
  )

  .procedure("copy")
  .withPermission("evaluations:manage")
  .handle(({ app, input, actor }) => app.copyToProject(input, { id: actor.id }))

  // ── The runs recorded against one ────────────────────────────────

  .procedure("getExperimentDSPyRuns")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const experiment = await app.getBySlug({
      projectId: input.projectId,
      slug: input.experimentSlug,
    });

    return app.listDspyRuns({ tenantId: input.projectId, experimentId: experiment.id });
  })

  .procedure("getExperimentDSPyStep")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const experiment = await app.getBySlug({
      projectId: input.projectId,
      slug: input.experimentSlug,
    });
    const step = await app.getDspyStep({
      tenantId: input.projectId,
      experimentId: experiment.id,
      runId: input.runId,
      stepIndex: input.index,
    });

    return toDspyStepWire(step);
  })

  .procedure("getExperimentBatchEvaluationRuns")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const experiment = await app.getById({ projectId: input.projectId, id: input.experimentId });

    const runsByExperimentId = await app.listRuns({
      projectId: input.projectId,
      experimentIds: [experiment.id],
    });

    return { runs: runsByExperimentId[experiment.id] ?? [] };
  })

  .procedure("getExperimentBatchEvaluationRun")
  .withPermission("experiments:view")
  .handle(async ({ app, input }) => {
    const experiment = await app.getById({ projectId: input.projectId, id: input.experimentId });

    return app.findRun({
      projectId: input.projectId,
      experimentId: experiment.id,
      runId: input.runId,
    });
  })

  .build();
