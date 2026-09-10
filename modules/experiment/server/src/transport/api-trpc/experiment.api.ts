/**
 * The project's experiments over a host's tRPC transport. Transport only:
 * policy, error translation, and delegation to `ExperimentApp`. Spec:
 * modules/experiment/specs/experiment-service.feature.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { Dataset } from "@langwatch/dataset-contract";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import {
  dSPyRunsSummarySchema,
  dSPyStepSchema,
  experimentArchivedSchema,
  experimentCopiedSchema,
  ExperimentDspyStepNotFoundError,
  experimentEvaluationsListPageSchema,
  experimentRunListSchema,
  experimentRunWithItemsSchema,
  experimentSavedWorkbenchSchema,
  experimentSchema,
  experimentUpdateFrameSchema,
  experimentWithDslSchema,
  experimentWorkbenchPageSchema,
  experimentWorkbenchVersionProbeSchema,
  experimentWorkbenchVersionsPageSchema,
  isLegacyOnlineEvaluationWorkbenchState,
  persistedEvaluationsV3StateSchema,
  workbenchSaveResultSchema,
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
 * The host supplies authentication; authorization arrives as `policy`. `app`
 * is the slice of the host's application this feature reaches, not the
 * feature's application itself — a tRPC root is shared by every feature.
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
   * The host's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission. Applied AFTER this feature's
   * own input parser, since the check reads its scope id from the input.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
  /**
   * Check every answer against the output schema its procedure declares. The
   * host decides: development and test ask for it, production does not.
   */
  validateOutput?: boolean;
}>;

/**
 * The host capabilities this transport needs that are not Experiment's own:
 * the workflow, monitor and identity verticals an experiment still reaches
 * through the application.
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
 * Only the two that have to change shape are listed; every other handled
 * error travels on unchanged, keeping its code and meta intact.
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
    const validateOutput = procedures.validateOutput ?? false;

    const workbench = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .mutation("saveExperiment", (p) =>
        p
          .withInput(
            projectScopeSchema.extend({
              experimentId: z.string().optional(),
              workbenchState: ports.workbenchStateSchema,
              dsl: studioWorkflowSchema,
              commitMessage: z.string().optional(),
            }),
          )
          .withOutput(experimentSchema)
          .withPermission("workflows:create")
          .handle(async ({ ctx, input }) => {
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
      )

      .mutation("saveEvaluationsV3", (p) =>
        p
          .withInput(
            projectScopeSchema.extend({
              experimentId: z.string().optional(),
              state: persistedEvaluationsV3StateSchema,
              /**
               * The version the client last read. Sending it turns the save
               * into a compare-and-set, refusing a save on top of someone
               * else's newer state; omitted means last-write-wins.
               */
              expectedVersion: z.number().int().optional(),
            }),
          )
          .withOutput(experimentSavedWorkbenchSchema)
          .withPermission("experiments:update")
          .handle(async ({ ctx, input }) => {
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
            const updatedExperiment = await experiments
              .getById({ projectId: input.projectId, id: saved.experimentId })
              .catch(mapExperimentError);
            // The row does not carry the version this save landed on — the counter
            // it holds is whatever the last read saw. Autosave compares the version
            // its own write produced against the staleness a concurrent broadcast
            // may already have raised, so the save result's version rides along.
            return { ...updatedExperiment, version: saved.version };
          }),
      )

      .query("getEvaluationsV3BySlug", (p) =>
        p
          .withInput(projectScopeSchema.extend({ experimentSlug: z.string() }))
          .withOutput(experimentWorkbenchPageSchema)
          .withPermission("experiments:view")
          .handle(async ({ ctx, input }) => {
            const workbenchState = await ctx.app.experiments
              .getWorkbenchState({ projectId: input.projectId, slug: input.experimentSlug })
              .catch(mapExperimentError);
            return {
              id: workbenchState.experimentId,
              slug: workbenchState.slug,
              workbenchState: workbenchState.state,
              version: workbenchState.version,
              updatedAt: workbenchState.updatedAt,
              // Who wrote the version the probing tab is comparing against. A tab
              // that has to tell its reader their work is out of date owes them the
              // name: Langy usually wrote it, on their behalf, in the page they are
              // looking at, and "somewhere else" reads as a stranger.
              ...(workbenchState.actorLabel !== undefined
                ? { actorLabel: workbenchState.actorLabel }
                : {}),
              // The run that wrote it, when a run did. A tab coming back from the
              // background adopts a version its own run wrote instead of standing
              // down over a write it already holds every cell of.
              ...(workbenchState.runId !== undefined ? { runId: workbenchState.runId } : {}),
            };
          }),
      )

      /**
       * The cheap staleness probe: the version and nothing else. A returning tab
       * compares it with the version it loaded and only refetches the whole state
       * when it is behind, so tab switching costs one point read, not one blob.
       */

      .query("getWorkbenchVersion", (p) =>
        p
          .withInput(projectScopeSchema.extend({ experimentSlug: z.string() }))
          .withOutput(experimentWorkbenchVersionProbeSchema)
          .withPermission("experiments:view")
          .handle(async ({ ctx, input }) => {
            const workbenchState = await ctx.app.experiments
              .getWorkbenchState({ projectId: input.projectId, slug: input.experimentSlug })
              .catch(mapExperimentError);
            return {
              experimentId: workbenchState.experimentId,
              version: workbenchState.version,
              updatedAt: workbenchState.updatedAt,
              // Who wrote the version the probing tab is comparing against. A tab
              // that has to tell its reader their work is out of date owes them the
              // name: Langy usually wrote it, on their behalf, in the page they are
              // looking at, and "somewhere else" reads as a stranger.
              ...(workbenchState.actorLabel !== undefined
                ? { actorLabel: workbenchState.actorLabel }
                : {}),
              // The run that wrote it, when a run did. A tab coming back from the
              // background adopts a version its own run wrote instead of standing
              // down over a write it already holds every cell of.
              ...(workbenchState.runId !== undefined ? { runId: workbenchState.runId } : {}),
            };
          }),
      )

      /**
       * SSE subscription pushing `experiment_updated` signals when a
       * workbench save lands. Signal-then-refetch; the payload never
       * carries state.
       */

      .subscription("onExperimentUpdate", (p) =>
        p
          .withInput(projectScopeSchema)
          .withOutput(experimentUpdateFrameSchema)
          .withPermission("experiments:view")
          .handle(async function* (opts) {
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
      )

      .query("listWorkbenchVersions", (p) =>
        p
          .withInput(
            projectScopeSchema.extend({
              experimentId: z.string(),
              limit: z.number().int().min(1).max(100).optional(),
              cursor: z.number().int().optional(),
            }),
          )
          .withOutput(experimentWorkbenchVersionsPageSchema)
          .withPermission("experiments:view")
          .handle(async ({ ctx, input }) => {
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
      )

      .mutation("commitWorkbenchVersion", (p) =>
        p
          .withInput(
            projectScopeSchema.extend({
              experimentId: z.string(),
              commitMessage: z.string().min(1),
            }),
          )
          .withOutput(workbenchSaveResultSchema)
          .withPermission("experiments:update")
          .handle(
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
      )

      .mutation("restoreWorkbenchVersion", (p) =>
        p
          .withInput(
            projectScopeSchema.extend({
              experimentId: z.string(),
              version: z.number().int().min(1),
            }),
          )
          .withOutput(workbenchSaveResultSchema)
          .withPermission("experiments:update")
          .handle(
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
      )

      .mutation("saveAsMonitor", (p) =>
        p
          .withInput(projectScopeSchema.extend({ experimentId: z.string() }))
          .withoutOutput(
            "the monitor upsert is the host's write and answers in the host's own shape; this transport only hands it the experiment it was built from",
          )
          .withPermission("workflows:create")
          .handle(async ({ ctx, input }) => {
            const experiment = await ctx.app.experiments
              .getById({ projectId: input.projectId, id: input.experimentId })
              .catch(mapExperimentError);
            const workflow = experiment.workflowId
              ? await ctx.app.experiments.findWorkflow({
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
      )
      .build();

    const experiments = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("getExperimentBySlugOrId", (p) =>
        p
          .withInput(
            projectScopeSchema.extend({
              experimentId: z.string().optional(),
              experimentSlug: z.string().optional(),
            }),
          )
          .withOutput(experimentSchema)
          .withPermission("experiments:view")
          .handle(async ({ ctx, input }) => {
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
      )

      .query("getExperimentWithDSLBySlug", (p) =>
        p
          .withInput(
            projectScopeSchema.extend({
              experimentSlug: z.string(),
              randomSeed: z.number().optional(),
            }),
          )
          .withOutput(experimentWithDslSchema)
          .withPermission("experiments:view")
          .handle(async ({ ctx, input }) => {
            const experiment = await ctx.app.experiments
              .getBySlug({ projectId: input.projectId, slug: input.experimentSlug })
              .catch(mapExperimentError);

            const workflow = experiment.workflowId
              ? await ctx.app.experiments.findWorkflow({
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
      )

      .query("getAllByProjectId", (p) =>
        p
          .withInput(projectScopeSchema)
          .withOutput(z.array(experimentSchema))
          .withPermission("experiments:view")
          .handle(async ({ ctx, input }) =>
            ctx.app.experiments.list({ projectId: input.projectId }),
          ),
      )

      .query("getAllForEvaluationsList", (p) =>
        p
          .withInput(
            projectScopeSchema.extend({
              pageOffset: z.number().optional(),
              pageSize: z.number().optional(),
            }),
          )
          .withOutput(experimentEvaluationsListPageSchema)
          .withPermission("experiments:view")
          .handle(async ({ ctx, input }) => {
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
                    ? await ctx.app.experiments.findWorkflow({
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
            const pagedExperiments = nonLegacyExperiments.slice(pageOffset, pageOffset + pageSize);

            const datasetIds = pagedExperiments
              .map((experiment) => datasetIdOf(experiment.workflow?.currentVersion?.dsl))
              .filter((id): id is string => !!id);

            const datasetsById = Object.fromEntries(
              (
                await ctx.app.experiments.getDatasets({ projectId: input.projectId, datasetIds })
              ).map((dataset: Dataset) => [dataset.id, { id: dataset.id, name: dataset.name }]),
            );

            const runsByExperimentId = await ctx.app.experiments.listRuns({
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
      )

      /** Whether the project's last experiment is still a draft. */

      .query("getLastExperiment", (p) =>
        p
          .withInput(projectScopeSchema)
          .withOutput(experimentSchema.nullable())
          .withPermission("experiments:view")
          .handle(
            async ({ ctx, input }) =>
              await ctx.app.experiments.findLatest({ projectId: input.projectId }),
          ),
      )

      /**
       * Archives an experiment (and cascades archive to its workflow +
       * monitor) via `archivedAt`, leaving historical data in place. The
       * tRPC name stays `deleteExperiment` for the UI's sake.
       */

      .mutation("deleteExperiment", (p) =>
        p
          .withInput(projectScopeSchema.extend({ experimentId: z.string() }))
          .withOutput(experimentArchivedSchema)
          .withPermission("workflows:delete")
          .handle(
            async ({ ctx, input }) =>
              // The cascade — the workflow the experiment wrote versions into, and
              // the monitor it was published as — is one act, and it is the
              // application's. A second door sequencing the same three writes is a
              // second chance to sequence them differently.
              await ctx.app.experiments
                .archive({ projectId: input.projectId, id: input.experimentId })
                .catch(mapExperimentError),
          ),
      )

      .mutation("copy", (p) =>
        p
          .withInput(
            z.object({
              experimentId: z.string(),
              projectId: z.string(),
              sourceProjectId: z.string(),
              copyDatasets: z.boolean().optional(),
            }),
          )
          .withOutput(experimentCopiedSchema)
          .withPermission("evaluations:manage")
          .handle(async ({ ctx, input }) => {
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
                message: "You do not have permission to manage evaluations in the source project",
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
            const sourceWorkflow = await ctx.app.experiments.findWorkflow({
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
      )
      .build();

    const runs = createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("getExperimentDSPyRuns", (p) =>
        p
          .withInput(projectScopeSchema.extend({ experimentSlug: z.string() }))
          .withOutput(z.array(dSPyRunsSummarySchema))
          .withPermission("experiments:view")
          .handle(async ({ ctx, input }) => {
            const experiment = await ctx.app.experiments
              .getBySlug({ projectId: input.projectId, slug: input.experimentSlug })
              .catch(mapExperimentError);

            return ctx.app.experiments.listDspyRuns({
              tenantId: input.projectId,
              experimentId: experiment.id,
            });
          }),
      )

      .query("getExperimentDSPyStep", (p) =>
        p
          .withInput(
            projectScopeSchema.extend({
              experimentSlug: z.string(),
              runId: z.string(),
              index: z.string(),
            }),
          )
          .withOutput(dSPyStepSchema)
          .withPermission("experiments:view")
          .handle(async ({ ctx, input }) => {
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
      )

      .query("getExperimentBatchEvaluationRuns", (p) =>
        p
          .withInput(projectScopeSchema.extend({ experimentId: z.string() }))
          .withOutput(experimentRunListSchema)
          .withPermission("experiments:view")
          .handle(async ({ ctx, input }) => {
            const experiment = await ctx.app.experiments
              .getById({ projectId: input.projectId, id: input.experimentId })
              .catch(mapExperimentError);

            const runsByExperimentId = await ctx.app.experiments.listRuns({
              projectId: input.projectId,
              experimentIds: [experiment.id],
            });

            return { runs: runsByExperimentId[experiment.id] ?? [] };
          }),
      )

      .query("getExperimentBatchEvaluationRun", (p) =>
        p
          .withInput(projectScopeSchema.extend({ experimentId: z.string(), runId: z.string() }))
          .withOutput(experimentRunWithItemsSchema.nullable())
          .withPermission("experiments:view")
          .handle(async ({ ctx, input }) => {
            const experiment = await ctx.app.experiments
              .getById({ projectId: input.projectId, id: input.experimentId })
              .catch(mapExperimentError);

            return ctx.app.experiments.findRun({
              projectId: input.projectId,
              experimentId: experiment.id,
              runId: input.runId,
            });
          }),
      )
      .build();

    // One surface, in the three groups the pages are laid out in. Several
    // chains rather than one because a single twenty-procedure chain exceeds
    // TypeScript's instantiation depth, and `mergeRouters` puts them back on
    // the one `experiments.*` name the client has always called.
    return trpc.mergeRouters(workbench, experiments, runs);
  }
}

/**
 * Copies an EVALUATIONS_V3 experiment to another project: the state in
 * `workbenchState` plus, optionally, the saved datasets it references.
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
    requestedSlug: slugify(experimentName),
    slugMode: "deduplicate",
    projectId: targetProjectId,
    type: "EVALUATIONS_V3",
    workflowId: null,
    workbenchState: z.json().parse(workbenchState),
  });

  return { experiment: newExperiment, workflow: null };
};
