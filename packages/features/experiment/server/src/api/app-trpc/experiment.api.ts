/**
 * The project's experiments over a host's tRPC transport.
 *
 *   saveExperiment:                 the batch-evaluation wizard's save, which
 *                                   also writes the workflow version behind it.
 *   saveEvaluationsV3:              the evaluations workbench autosave, with an
 *                                   optional compare-and-set on the version.
 *   getEvaluationsV3BySlug:         the workbench state a page opens on.
 *   onExperimentUpdate:             the freshness signal a second tab follows.
 *   listWorkbenchVersions:          the version history drawer.
 *   commitWorkbenchVersion:         naming the current state a version.
 *   restoreWorkbenchVersion:        going back to one.
 *   saveAsMonitor:                  turning a wizard experiment into a monitor.
 *   getExperimentBySlugOrId:        one experiment, however the page names it.
 *   getExperimentWithDSLBySlug:     one experiment plus the workflow DSL.
 *   getAllByProjectId:              every active experiment.
 *   getAllForEvaluationsList:       the evaluations list page.
 *   getExperimentDSPyRuns:          the optimization runs on an experiment.
 *   getExperimentDSPyStep:          one optimization step, in the wire shape.
 *   getExperimentBatchEvaluationRuns / …Run: the run list and one run.
 *   deleteExperiment:               archive, cascading to workflow and monitor.
 *   copy:                           the same experiment in another project.
 *   getLastExperiment:              whether the last one is still a draft.
 *
 * Reading takes `experiments:view`; the workbench writes take
 * `experiments:update`; the wizard writes, which create a workflow, take
 * `workflows:create`, and archiving takes `workflows:delete`. `copy` takes
 * `evaluations:manage` on the target AND is probed for the same on the source,
 * because the declared check only ever covers the project in the input.
 *
 * Transport only: policy, error translation, and delegation to
 * `ExperimentApp`. The workflow, dataset, monitor and broadcast collaborators
 * an experiment reaches are that application's dependencies; what still
 * arrives as a host port is the work the host does per request — the workflow
 * writes, the monitor upsert, the permission probe and the author-name lookup
 * — while those verticals are drained.
 *
 * Spec: packages/features/experiment/specs/experiment-service.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { Dataset } from "@langwatch/dataset-contract";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import {
  ExperimentDspyStepNotFoundError,
  isLegacyOnlineEvaluationWorkbenchState,
  persistedEvaluationsV3StateSchema,
  type DSPyStep,
  type SaveExperimentInput,
} from "@langwatch/experiment-contract";
import {
  parseStudioWorkflow,
  studioWorkflowSchema,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { on } from "node:events";
import { z } from "zod";
import type { ExperimentApp } from "#app/experiment.app";

/**
 * The host supplies authentication; authorization arrives as `policy`.
 *
 * `app` is the slice of the host's application this feature reaches, not the
 * feature's application itself, because a tRPC root is shared by every feature
 * mounted on it and so carries all of them. The REST family, built per mount,
 * holds {@link ExperimentApp} directly. The workflow, dataset, monitor and
 * broadcast collaborators an experiment reaches are that application's
 * dependencies rather than four more keys here, so a REST door can reach every
 * one of them too.
 */
export type ExperimentTrpcContext = Readonly<{
  app: Readonly<{ experiments: ExperimentApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type ExperimentTrpcProcedures<
  TContext extends ExperimentTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The host's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The host's tracing, logging, error, scope-lineage, authorization and audit
   * policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * The host capabilities this transport needs that are not Experiment's own.
 *
 * All of them are the workflow, monitor and identity verticals an experiment
 * still reaches through the application; each is handed the request context so
 * the host resolves the caller exactly as it always did.
 */
export type ExperimentTrpcPorts<TWorkbenchState> = Readonly<{
  /**
   * The legacy wizard's persisted state. Injected because its shape is built
   * out of the host's evaluation preconditions and trace-mapping schemas, which
   * have not moved.
   */
  workbenchStateSchema: z.ZodType<TWorkbenchState>;
  /** The host's slug derivation, shared with every other slugged resource. */
  slugify(value: string): string;
  /**
   * Whether the caller holds `permission` on `projectId`. `copy` reads a SECOND
   * project the declared check never covers — the source — so it is probed
   * separately before anything is read from it.
   */
  probeProjectPermission(
    ctx: ExperimentTrpcContext,
    projectId: string,
    permission: AuthzPermission,
  ): Promise<boolean>;
  /** Writes a workflow version, autosaved or committed. */
  saveWorkflowVersion(
    ctx: ExperimentTrpcContext,
    input: Readonly<{
      projectId: string;
      workflowId: string;
      dsl: StudioWorkflow;
      autoSaved: boolean;
      commitMessage: string;
      setAsLatestVersion?: boolean;
    }>,
  ): Promise<unknown>;
  /** Copies a workflow, and optionally its datasets, into another project. */
  copyWorkflowWithDatasets(
    ctx: ExperimentTrpcContext,
    input: Readonly<{
      workflow: Readonly<{
        id: string;
        name: string;
        icon: string | null;
        description: string | null;
        isEvaluator?: boolean;
        isComponent?: boolean;
        latestVersion: Readonly<{ dsl: unknown }> | null;
      }>;
      targetProjectId: string;
      sourceProjectId: string;
      copyDatasets?: boolean;
      copiedFromWorkflowId?: string;
    }>,
  ): Promise<Readonly<{ workflowId: string; dsl: StudioWorkflow }>>;
  /** Creates the workflow a new wizard experiment writes its versions into. */
  createWorkflow(
    ctx: ExperimentTrpcContext,
    input: Readonly<{
      projectId: string;
      name: string;
      icon?: string | null;
      description?: string | null;
    }>,
  ): Promise<Readonly<{ id: string }>>;
  /**
   * One workflow by id within a project, or null. Reads the row directly rather
   * than through the workflow service because the wizard save only needs to
   * know the id still resolves inside this project.
   */
  tryFindWorkflow(
    ctx: ExperimentTrpcContext,
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<Readonly<{ id: string }> | null>;
  /**
   * The trace mapping a monitor stores, coerced from whatever shape the wizard
   * saved. The mapping vocabulary is the host's tracer.
   */
  coerceMonitorMappings(mappings: unknown): unknown;
  /** Creates or replaces the monitor an experiment is published as. */
  upsertExperimentMonitor(
    ctx: ExperimentTrpcContext,
    input: Readonly<{
      projectId: string;
      experimentId: string;
      monitor: Readonly<{
        name: string;
        checkType: string;
        slug: string;
        preconditions: unknown;
        parameters: Record<string, unknown>;
        mappings: unknown;
        sample: number;
        enabled: boolean;
        executionMode: string;
      }>;
    }>,
  ): Promise<unknown>;
  /**
   * The display names behind the author ids on a version history. Resolved at
   * the transport rather than in the service because it is a display concern:
   * the REST surface publishes the id and lets the caller decide.
   */
  resolveAuthorNames(
    ctx: ExperimentTrpcContext,
    authorIds: readonly string[],
  ): Promise<ReadonlyArray<Readonly<{ id: string; name: string | null }>>>;
}>;

/**
 * Maps experiment domain errors to `TRPCError` using the code discriminant.
 *
 * Only the two that have to change shape are listed. Every other handled error
 * travels on unchanged, which is what keeps its code and its meta reaching the
 * client instead of being flattened into prose here.
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

const projectScopeSchema = z.object({ projectId: z.string() });

/**
 * Installs the complete `experiments.*` tRPC surface on a host-owned root. The
 * procedure and the policy are injected by the host so its auth, audit, error,
 * logging and tracing policies wrap every feature procedure consistently.
 */
export class ExperimentTrpcApi {
  static create<
    TContext extends ExperimentTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TWorkbenchState,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: ExperimentTrpcProcedures<TContext, TOptions, TRoot>,
    ports: ExperimentTrpcPorts<TWorkbenchState>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      saveExperiment: policy("workflows:create")(
        procedure.input(
          projectScopeSchema.extend({
            experimentId: z.string().optional(),
            workbenchState: ports.workbenchStateSchema,
            dsl: studioWorkflowSchema,
            commitMessage: z.string().optional(),
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
        const experiments = ctx.app.experiments;
        const state = input.workbenchState as { name?: string | null };

        let workflowId = input.dsl.workflow_id;
        const name =
          state.name ?? (await experiments.findNextDraftName({ projectId: input.projectId }));

        if (input.experimentId) {
          const currentExperiment = await experiments
            .getById({ projectId: input.projectId, id: input.experimentId })
            .catch(mapExperimentError);

          if (currentExperiment.workflowId) {
            const workflow = await ports.tryFindWorkflow(ctx, {
              workflowId: currentExperiment.workflowId,
              projectId: input.projectId,
            });

            if (!workflow) {
              throw new TRPCError({ code: "NOT_FOUND", message: "Workflow not found" });
            }

            workflowId = workflow.id;
          }

          // Rename the experiment's datasets alongside it, so a renamed
          // experiment does not leave its datasets pointing at the old name.
          if (currentExperiment.name && currentExperiment.name !== name) {
            const datasetIds = input.dsl.nodes
              .filter((node) => node.type === "dataset")
              .map((node) => (node.data as { dataset?: { id?: string } }).dataset?.id)
              .filter((id): id is string => !!id);

            const datasets = await ctx.app.experiments.getDatasets({
              datasetIds,
              projectId: input.projectId,
            });

            for (const dataset of datasets) {
              if (dataset.name.startsWith(currentExperiment.name)) {
                await ctx.app.experiments.renameDataset({
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
          const workflow = await ports.createWorkflow(ctx, {
            projectId: input.projectId,
            name: workflowName,
            icon: input.dsl.icon,
            description: input.dsl.description,
          });

          workflowId = workflow.id;
        }

        await ports.saveWorkflowVersion(ctx, {
          projectId: input.projectId,
          workflowId,
          dsl: { ...input.dsl, workflow_id: workflowId, name: workflowName },
          autoSaved: !input.commitMessage,
          commitMessage: input.commitMessage ?? "Autosaved",
          setAsLatestVersion: true,
        });

        const experimentId = input.experimentId ?? generate("experiment").toString();

        return experiments
          .save({
            id: experimentId,
            projectId: input.projectId,
            name,
            type: "BATCH_EVALUATION_V2",
            requestedSlug: ports.slugify(name),
            slugMode: input.experimentId ? "preserve-existing" : "deduplicate",
            workflowId,
            // The stored state is whatever the host's wizard schema admitted,
            // which is JSON by construction; the service stores it verbatim.
            workbenchState: input.workbenchState as SaveExperimentInput["workbenchState"],
          })
          .catch(mapExperimentError);
      }),

      saveEvaluationsV3: policy("experiments:update")(
        procedure.input(
          projectScopeSchema.extend({
            experimentId: z.string().optional(),
            state: persistedEvaluationsV3StateSchema,
            /**
             * The version the client last read. Sending it turns the save into
             * a compare-and-set: a save on top of someone else's newer state is
             * refused instead of overwriting it. Omitted means last-write-wins,
             * which is what the existing autosave does until it tracks versions.
             */
            expectedVersion: z.number().int().optional(),
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
        const experiments = ctx.app.experiments;
        const experimentId = input.experimentId ?? generate("experiment").toString();

        const saved = await experiments
          .saveWorkbenchState(
            {
              projectId: input.projectId,
              id: experimentId,
              state: input.state,
              ...(input.expectedVersion === undefined
                ? {}
                : { expectedVersion: input.expectedVersion }),
            },
            { kind: "user", id: ctx.actor().id },
          )
          .catch(mapExperimentError);
        return await experiments
          .getById({ projectId: input.projectId, id: saved.experimentId })
          .catch(mapExperimentError);
      }),

      getEvaluationsV3BySlug: policy("experiments:view")(
        procedure.input(projectScopeSchema.extend({ experimentSlug: z.string() })),
      ).query(async ({ ctx, input }) => {
        const workbench = await ctx.app.experiments
          .getWorkbenchState({ projectId: input.projectId, slug: input.experimentSlug })
          .catch(mapExperimentError);
        return {
          id: workbench.experimentId,
          slug: workbench.slug,
          workbenchState: workbench.state,
          version: workbench.version,
          updatedAt: workbench.updatedAt,
          // Who wrote the version the probing tab is comparing against. A tab
          // that has to tell its reader their work is out of date owes them the
          // name: Langy usually wrote it, on their behalf, in the page they are
          // looking at, and "somewhere else" reads as a stranger.
          ...(workbench.actorLabel !== undefined ? { actorLabel: workbench.actorLabel } : {}),
          // The run that wrote it, when a run did. A tab coming back from the
          // background adopts a version its own run wrote instead of standing
          // down over a write it already holds every cell of.
          ...(workbench.runId !== undefined ? { runId: workbench.runId } : {}),
        };
      }),

      /**
       * SSE subscription pushing `experiment_updated` signals when a workbench
       * save lands, whoever wrote it: the editor's own autosave, a Langy backend
       * write, or the REST API. Signal-then-refetch; the payload never carries
       * state.
       */
      onExperimentUpdate: policy("experiments:view")(
        procedure.input(projectScopeSchema),
      ).subscription(async function* (opts) {
        const { projectId } = opts.input;
        const emitter = opts.ctx.app.experiments.getTenantEmitter(projectId);
        try {
          for await (const eventArgs of on(emitter, "experiment_updated", {
            signal: (opts as { signal?: AbortSignal }).signal,
          })) {
            yield (eventArgs as unknown[])[0] as { event?: unknown; timestamp?: number };
          }
        } finally {
          opts.ctx.app.experiments.cleanupTenantEmitter(projectId);
        }
      }),

      listWorkbenchVersions: policy("experiments:view")(
        procedure.input(
          projectScopeSchema.extend({
            experimentId: z.string(),
            limit: z.number().int().min(1).max(100).optional(),
            cursor: z.number().int().optional(),
          }),
        ),
      ).query(async ({ ctx, input }) => {
        const page = await ctx.app.experiments
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
        const authors =
          authorIds.length > 0 ? await ports.resolveAuthorNames(ctx, authorIds) : [];
        const nameById = new Map(authors.map((author) => [author.id, author.name]));

        return {
          ...page,
          versions: page.versions.map((version) => ({
            ...version,
            authorName: version.authorId ? (nameById.get(version.authorId) ?? null) : null,
          })),
        };
      }),

      commitWorkbenchVersion: policy("experiments:update")(
        procedure.input(
          projectScopeSchema.extend({
            experimentId: z.string(),
            commitMessage: z.string().min(1),
          }),
        ),
      ).mutation(
        async ({ ctx, input }) =>
          await ctx.app.experiments
            .commitWorkbenchVersion(
              {
                projectId: input.projectId,
                id: input.experimentId,
                commitMessage: input.commitMessage,
              },
              { kind: "user", id: ctx.actor().id },
            )
            .catch(mapExperimentError),
      ),

      restoreWorkbenchVersion: policy("experiments:update")(
        procedure.input(
          projectScopeSchema.extend({
            experimentId: z.string(),
            version: z.number().int().min(1),
          }),
        ),
      ).mutation(
        async ({ ctx, input }) =>
          await ctx.app.experiments
            .restoreWorkbenchVersion(
              {
                projectId: input.projectId,
                id: input.experimentId,
                version: input.version,
              },
              { kind: "user", id: ctx.actor().id },
            )
            .catch(mapExperimentError),
      ),

      saveAsMonitor: policy("workflows:create")(
        procedure.input(projectScopeSchema.extend({ experimentId: z.string() })),
      ).mutation(async ({ ctx, input }) => {
        const experiment = await ctx.app.experiments
          .getById({ projectId: input.projectId, id: input.experimentId })
          .catch(mapExperimentError);
        const workflow = experiment.workflowId
          ? await ctx.app.experiments.tryGetWorkflow({
              id: experiment.workflowId,
              projectId: input.projectId,
              includeVersion: true,
            })
          : null;

        const workbenchState = experiment.workbenchState as
          | {
              realTimeExecution?: { preconditions?: unknown; sample?: number };
              realTimeTraceMappings?: unknown;
            }
          | undefined;
        const dsl = workflow?.currentVersion?.dsl as StudioWorkflow | undefined;
        const evaluator = dsl?.nodes.find((node) => node.type === "evaluator");
        const evaluatorData = evaluator?.data as
          | {
              evaluator?: string;
              parameters?: ReadonlyArray<{ identifier: string; value: unknown }>;
            }
          | undefined;

        if (!workbenchState || !dsl || !evaluatorData?.evaluator) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Experiment is not ready to be saved as a monitor",
          });
        }

        return await ports.upsertExperimentMonitor(ctx, {
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
            mappings: ports.coerceMonitorMappings(workbenchState.realTimeTraceMappings),
            sample: workbenchState.realTimeExecution?.sample ?? 1,
            enabled: true,
            executionMode: "ON_MESSAGE",
          },
        });
      }),

      getExperimentBySlugOrId: policy("experiments:view")(
        procedure.input(
          projectScopeSchema.extend({
            experimentId: z.string().optional(),
            experimentSlug: z.string().optional(),
          }),
        ),
      ).query(async ({ ctx, input }) => {
        if (input.experimentId) {
          return await ctx.app.experiments
            .getById({ projectId: input.projectId, id: input.experimentId })
            .catch(mapExperimentError);
        } else if (input.experimentSlug) {
          return await ctx.app.experiments
            .getBySlug({ projectId: input.projectId, slug: input.experimentSlug })
            .catch(mapExperimentError);
        }

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Either experimentId or experimentSlug must be provided",
        });
      }),

      getExperimentWithDSLBySlug: policy("experiments:view")(
        procedure.input(
          projectScopeSchema.extend({
            experimentSlug: z.string(),
            randomSeed: z.number().optional(),
          }),
        ),
      ).query(async ({ ctx, input }) => {
        const experiment = await ctx.app.experiments
          .getBySlug({ projectId: input.projectId, slug: input.experimentSlug })
          .catch(mapExperimentError);

        const workflow = experiment.workflowId
          ? await ctx.app.experiments.tryGetWorkflow({
              id: experiment.workflowId,
              projectId: input.projectId,
              includeVersion: true,
            })
          : undefined;

        return {
          ...experiment,
          workbenchState: experiment.workbenchState as TWorkbenchState | undefined,
          dsl: workflow?.currentVersion?.dsl
            ? parseStudioWorkflow(workflow.currentVersion.dsl)
            : undefined,
        };
      }),

      getAllByProjectId: policy("experiments:view")(
        procedure.input(projectScopeSchema),
      ).query(async ({ ctx, input }) => ctx.app.experiments.list({ projectId: input.projectId })),

      getAllForEvaluationsList: policy("experiments:view")(
        procedure.input(
          projectScopeSchema.extend({
            pageOffset: z.number().optional(),
            pageSize: z.number().optional(),
          }),
        ),
      ).query(async ({ ctx, input }) => {
        const pageOffset = input.pageOffset ?? 0;
        const pageSize = input.pageSize ?? 25;

        // Fetch every active experiment with its workflow+currentVersion join,
        // then filter/paginate in JS. Prisma JSON-path filtering is unreliable
        // for the `task` field inside `workbenchState`, so the count and the
        // page slice both run off the same in-memory array.
        const allExperiments = await Promise.all(
          (await ctx.app.experiments.list({ projectId: input.projectId })).map(
            async (experiment) => ({
              ...experiment,
              workflow: experiment.workflowId
                ? await ctx.app.experiments.tryGetWorkflow({
                    id: experiment.workflowId,
                    projectId: input.projectId,
                    includeVersion: true,
                  })
                : null,
            }),
          ),
        );
        const nonLegacyExperiments = allExperiments.filter(
          (experiment) => !isLegacyOnlineEvaluationWorkbenchState(experiment.workbenchState),
        );
        const totalHits = nonLegacyExperiments.length;

        // Pagination is applied after excluding legacy online evaluations.
        const experiments = nonLegacyExperiments.slice(pageOffset, pageOffset + pageSize);

        const datasetIds = experiments
          .map((experiment) => datasetIdOf(experiment.workflow?.currentVersion?.dsl))
          .filter((id): id is string => !!id);

        const datasetsById = Object.fromEntries(
          (
            await ctx.app.experiments.getDatasets({ projectId: input.projectId, datasetIds })
          ).map((dataset: Dataset) => [dataset.id, { id: dataset.id, name: dataset.name }]),
        );

        const runsByExperimentId = await ctx.app.experiments.listRuns({
          projectId: input.projectId,
          experimentIds: experiments.map((experiment) => experiment.id),
        });

        const experimentsWithDatasetsAndRuns = experiments
          .map((experiment) => {
            const runs = runsByExperimentId[experiment.id] ?? [];
            const latestRun = runs.sort(
              (a, b) => b.timestamps.createdAt - a.timestamps.createdAt,
            )[0];
            const primaryMetric = latestRun
              ? Object.values(latestRun.summary.evaluations)[0]
              : undefined;

            return {
              ...experiment,
              workbenchState: experiment.workbenchState as TWorkbenchState | undefined,
              runsSummary: {
                count: runs.length,
                primaryMetric,
                latestRun: { timestamps: latestRun?.timestamps },
              },
              dataset:
                datasetsById[datasetIdOf(experiment.workflow?.currentVersion?.dsl) ?? ""],
              updatedAt: latestRun?.timestamps.createdAt ?? experiment.updatedAt.getTime(),
            };
          })
          .sort((a, b) => b.updatedAt - a.updatedAt);

        return { experiments: experimentsWithDatasetsAndRuns, totalHits };
      }),

      getExperimentDSPyRuns: policy("experiments:view")(
        procedure.input(projectScopeSchema.extend({ experimentSlug: z.string() })),
      ).query(async ({ ctx, input }) => {
        const experiment = await ctx.app.experiments
          .getBySlug({ projectId: input.projectId, slug: input.experimentSlug })
          .catch(mapExperimentError);

        return ctx.app.experiments.listDspyRuns({
          tenantId: input.projectId,
          experimentId: experiment.id,
        });
      }),

      getExperimentDSPyStep: policy("experiments:view")(
        procedure.input(
          projectScopeSchema.extend({
            experimentSlug: z.string(),
            runId: z.string(),
            index: z.string(),
          }),
        ),
      ).query(async ({ ctx, input }) => {
        const experiment = await ctx.app.experiments
          .getBySlug({ projectId: input.projectId, slug: input.experimentSlug })
          .catch(mapExperimentError);

        try {
          const step = await ctx.app.experiments.getDspyStep({
            tenantId: input.projectId,
            experimentId: experiment.id,
            runId: input.runId,
            stepIndex: input.index,
          });

          // The domain type is camelCase; the page reads the snake_case wire
          // shape the optimization studio has always published.
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
      }),

      getExperimentBatchEvaluationRuns: policy("experiments:view")(
        procedure.input(projectScopeSchema.extend({ experimentId: z.string() })),
      ).query(async ({ ctx, input }) => {
        const experiment = await ctx.app.experiments
          .getById({ projectId: input.projectId, id: input.experimentId })
          .catch(mapExperimentError);

        const runsByExperimentId = await ctx.app.experiments.listRuns({
          projectId: input.projectId,
          experimentIds: [experiment.id],
        });

        return { runs: runsByExperimentId[experiment.id] ?? [] };
      }),

      getExperimentBatchEvaluationRun: policy("experiments:view")(
        procedure.input(
          projectScopeSchema.extend({ experimentId: z.string(), runId: z.string() }),
        ),
      ).query(async ({ ctx, input }) => {
        const experiment = await ctx.app.experiments
          .getById({ projectId: input.projectId, id: input.experimentId })
          .catch(mapExperimentError);

        return ctx.app.experiments.tryGetRun({
          projectId: input.projectId,
          experimentId: experiment.id,
          runId: input.runId,
        });
      }),

      /**
       * Archives an experiment (and cascades archive to its workflow + monitor).
       *
       * Previously this procedure hard-deleted the Postgres rows AND issued
       * DELETE FROM on `experiment_runs`, `experiment_run_items`, `dspy_steps`
       * in ClickHouse plus a deleteByQuery against the Elasticsearch
       * `batch_evaluation` index. Every such delete writes a lightweight-delete
       * mask onto every cold-tier S3 part containing matching rows, then the
       * background merges rewrite those parts to actually purge. At ~3-45 user
       * deletes/day across prod, that workload was costing ~$200/mo in S3
       * requests alone and tripping AWS Cost Anomaly Detection on heavy days.
       *
       * The Experiment model now matches the pattern used everywhere else in
       * this schema: archive via `archivedAt`, hide from list queries, leave the
       * historical data in place.
       *
       * The tRPC name remains `deleteExperiment` so the UI does not need to
       * change; the user-visible behaviour is identical.
       */
      deleteExperiment: policy("workflows:delete")(
        procedure.input(projectScopeSchema.extend({ experimentId: z.string() })),
      ).mutation(
        async ({ ctx, input }) =>
          // The cascade — the workflow the experiment wrote versions into, and
          // the monitor it was published as — is one act, and it is the
          // application's. A second door sequencing the same three writes is a
          // second chance to sequence them differently.
          await ctx.app.experiments
            .archive({ projectId: input.projectId, id: input.experimentId })
            .catch(mapExperimentError),
      ),

      copy: policy("evaluations:manage")(
        procedure.input(
          z.object({
            experimentId: z.string(),
            projectId: z.string(),
            sourceProjectId: z.string(),
            copyDatasets: z.boolean().optional(),
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
        // The declared check covers the TARGET project. The source is a second
        // project it never saw, so it is probed before anything is read.
        const hasSourcePermission = await ports.probeProjectPermission(
          ctx,
          input.sourceProjectId,
          "evaluations:manage",
        );

        if (!hasSourcePermission) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message:
              "You do not have permission to manage evaluations in the source project",
          });
        }

        const experiment = await ctx.app.experiments
          .getById({ projectId: input.sourceProjectId, id: input.experimentId })
          .catch(mapExperimentError);

        // V3 experiments have no workflow; their state lives in workbenchState.
        if (experiment.type === "EVALUATIONS_V3") {
          return await copyEvaluationsV3Experiment({
            app: ctx.app.experiments,
            slugify: ports.slugify,
            experiment,
            targetProjectId: input.projectId,
            sourceProjectId: input.sourceProjectId,
            ...(input.copyDatasets === undefined ? {} : { copyDatasets: input.copyDatasets }),
          });
        }

        if (!experiment.workflowId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Experiment workflow not found" });
        }
        const sourceWorkflow = await ctx.app.experiments.tryGetWorkflow({
          id: experiment.workflowId,
          projectId: input.sourceProjectId,
          includeVersion: true,
        });
        if (!sourceWorkflow?.latestVersion?.dsl) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Experiment workflow not found" });
        }

        const { workflowId, dsl } = await ports.copyWorkflowWithDatasets(ctx, {
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

        const newWorkflow = await ports.tryFindWorkflow(ctx, {
          workflowId,
          projectId: input.projectId,
        });

        if (!newWorkflow) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create workflow",
          });
        }

        await ports.saveWorkflowVersion(ctx, {
          projectId: input.projectId,
          workflowId,
          dsl,
          autoSaved: false,
          commitMessage: `Copied from ${sourceWorkflow.name}`,
        });

        const experimentName = experiment.name ?? experiment.slug;
        const newExperiment = await ctx.app.experiments.save({
          id: generate("experiment").toString(),
          name: experimentName,
          requestedSlug: ports.slugify(experimentName),
          slugMode: "deduplicate",
          projectId: input.projectId,
          type: experiment.type,
          workflowId,
          workbenchState: experiment.workbenchState,
        });

        return { experiment: newExperiment, workflow: newWorkflow };
      }),

      /** Whether the project's last experiment is still a draft. */
      getLastExperiment: policy("experiments:view")(
        procedure.input(projectScopeSchema),
      ).query(
        async ({ ctx, input }) =>
          await ctx.app.experiments.tryGetLatest({ projectId: input.projectId }),
      ),
    });
  }
}

/**
 * Copies an EVALUATIONS_V3 experiment to another project.
 *
 * V3 experiments store their state in `workbenchState` and have no workflow, so
 * the copy is the state plus, optionally, the saved datasets it references.
 */
const copyEvaluationsV3Experiment = async ({
  app,
  slugify,
  experiment,
  targetProjectId,
  sourceProjectId,
  copyDatasets,
}: {
  app: ExperimentApp;
  slugify(value: string): string;
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
  const workbenchState = JSON.parse(
    JSON.stringify(experiment.workbenchState ?? {}),
  ) as Record<string, unknown>;

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
    requestedSlug: slugify(experimentName),
    slugMode: "deduplicate",
    projectId: targetProjectId,
    type: "EVALUATIONS_V3",
    workflowId: null,
    workbenchState: z.json().parse(workbenchState),
  });

  return { experiment: newExperiment, workflow: null };
};
