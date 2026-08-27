import { HandledError } from "@langwatch/handled-error";
import { ExperimentDspyStepNotFoundError } from "@langwatch/experiment-contract";
import { generate } from "@langwatch/ksuid";
import type { JsonValue } from "@prisma/client/runtime/client";
import { TRPCError } from "@trpc/server";
import type { Node } from "@xyflow/react";
import type { Dataset } from "@langwatch/dataset-contract";
import { WorkflowNotFoundError } from "@langwatch/workflow-contract";
import { nanoid } from "nanoid";
import { z } from "zod";
import { EvaluationExecutionMode, ExperimentType } from "~/generated/prisma/client";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { persistedEvaluationsV3StateSchema } from "../../../experiments-v3/types/persistence";
import {
  parseStudioWorkflow,
  type Entry,
  type Evaluator,
  type StudioWorkflow,
  studioWorkflowSchema,
} from "@langwatch/workflow-contract";
import { slugify } from "../../../utils/slugify";
import { prisma } from "../../db";
import type {
  DSPyStep,
} from "@langwatch/experiment-contract";
import { isLegacyOnlineEvaluationWorkbenchState } from "@langwatch/experiment-contract";
import {
  type WizardState,
  workbenchStateSchema,
} from "../../experiments/legacy-experiment-workbench.schema";
import { coerceMonitorMappings } from "../../tracer/tracesMapping";
import {
  type createInnerTRPCContext,
  createTRPCRouter,
  protectedProcedure,
} from "../trpc";
import { copyWorkflowWithDatasets, saveOrCommitWorkflowVersion } from "./workflows";

type TRPCContext = ReturnType<typeof createInnerTRPCContext>;

/**
 * Maps experiment domain errors to TRPCError using the code discriminant.
 *
 * Only the two that have to change shape are listed. Every other handled
 * error travels on unchanged, which is what keeps its code and its meta
 * reaching the client instead of being flattened into prose here.
 */
const mapExperimentError = (error: unknown): never => {
  if (HandledError.isHandled(error) && error.code === "experiment_not_found") {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error instanceof ExperimentTypeMismatchError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
};

export const experimentsRouter = createTRPCRouter({
  saveExperiment: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string().optional(),
        workbenchState: workbenchStateSchema,
        dsl: studioWorkflowSchema,
        commitMessage: z.string().optional(),
      }),
    )
    .permission("workflows:create")
    .mutation(async ({ ctx, input }) => {
      const experiments = ctx.app.experiments;

      let workflowId = input.dsl.workflow_id;
      const name =
        input.workbenchState.name ??
        (await experiments.findNextDraftName({
          projectId: input.projectId,
        }));
      if (input.experimentId) {
        const currentExperiment = await experiments
          .getById({
            projectId: input.projectId,
            id: input.experimentId,
          })
          .catch(mapExperimentError);

        if (currentExperiment.workflowId) {
          const workflow = await prisma.workflow.findUnique({
            where: {
              id: currentExperiment.workflowId,
              projectId: input.projectId,
            },
          });

          if (!workflow) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Workflow not found",
            });
          }

          workflowId = workflow.id;
        }

        // Update dataset names as well if experiment name changes
        if (currentExperiment.name && currentExperiment.name !== name) {
          const datasetIds = input.dsl.nodes
            .filter((node: Node<Entry>) => node.type === "dataset")
            .map((node: Node<Entry>) => node.data.dataset?.id)
            .filter(Boolean) as string[];

          const datasets = await ctx.app.dataset.getByIds({
            datasetIds,
            projectId: input.projectId,
          });

          for (const dataset of datasets) {
            if (dataset.name.startsWith(currentExperiment.name)) {
              await ctx.app.dataset.renameDataset({
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
        const workflow = await ctx.prisma.workflow.create({
          data: {
            id: `workflow_${nanoid()}`,
            projectId: input.projectId,
            name: workflowName,
            icon: input.dsl.icon,
            description: input.dsl.description,
          },
        });

        workflowId = workflow.id;
      }

      await saveOrCommitWorkflowVersion({
        ctx,
        input: {
          projectId: input.projectId,
          workflowId: workflowId,
          dsl: {
            ...input.dsl,
            workflow_id: workflowId,
            name: workflowName,
          },
        },
        autoSaved: !input.commitMessage,
        commitMessage: input.commitMessage ?? "Autosaved",
        setAsLatestVersion: true,
      });

      const experimentId = input.experimentId ?? `experiment_${nanoid()}`;

      return experiments
        .save({
          id: experimentId,
          projectId: input.projectId,
          name,
          type: ExperimentType.BATCH_EVALUATION_V2,
          requestedSlug: slugify(name),
          slugMode: input.experimentId ? "preserve-existing" : "deduplicate",
          workflowId,
          workbenchState: input.workbenchState,
        })
        .catch(mapExperimentError);
    }),

  saveEvaluationsV3: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string().optional(),
        state: persistedEvaluationsV3StateSchema,
        /**
         * The version the client last read. Sending it turns the save into a
         * compare-and-set: a save on top of someone else's newer state is
         * refused instead of overwriting it. Omitted means last-write-wins,
         * which is what the existing autosave does until it tracks versions.
         */
        expectedVersion: z.number().int().optional(),
      }),
    )
    .permission("experiments:update")
    .mutation(async ({ ctx, input }) => {
      const experiments = ctx.app.experiments;
      const experimentId =
        input.experimentId ?? generate(KSUID_RESOURCES.EXPERIMENT).toString();

      const name =
        input.state.name ||
        (await experiments.findNextDraftName({
          projectId: input.projectId,
        }));

      const rawSlug = input.state.experimentSlug ?? experimentId.slice(-8);
      const workbenchStateJson = JSON.parse(JSON.stringify(input.state));
      return experiments
        .save({
          id: experimentId,
          projectId: input.projectId,
          name,
          type: ExperimentType.EVALUATIONS_V3,
          requestedSlug: rawSlug,
          slugMode: input.experimentId ? "preserve-existing" : "deduplicate",
          workflowId: null,
          workbenchState: workbenchStateJson,
        })
        .catch(mapExperimentError);
    }),

  getEvaluationsV3BySlug: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentSlug: z.string(),
      }),
    )
    .permission("experiments:view")
    .query(async ({ ctx, input }) => {
      const experiment = await ctx.app.experiments
        .getBySlug({
          projectId: input.projectId,
          slug: input.experimentSlug,
        })
        .catch(mapExperimentError);
      return {
        experimentId: workbench.experimentId,
        version: workbench.version,
        updatedAt: workbench.updatedAt,
        // Who wrote the version the probing tab is comparing against. A tab
        // that has to tell its reader their work is out of date owes them the
        // name: Langy usually wrote it, on their behalf, in the page they are
        // looking at, and "somewhere else" reads as a stranger.
        ...(workbench.actorLabel !== undefined
          ? { actorLabel: workbench.actorLabel }
          : {}),
        // The run that wrote it, when a run did. A tab coming back from the
        // background adopts a version its own run wrote instead of standing
        // down over a write it already holds every cell of.
        ...(workbench.runId !== undefined ? { runId: workbench.runId } : {}),
      };
    }),

  /**
   * SSE subscription pushing `experiment_updated` signals when a workbench
   * save lands, whoever wrote it: the editor's own autosave, a Langy backend
   * write, or the REST API. Signal-then-refetch like `langy.onConversationUpdate`;
   * the payload never carries state.
   */
  onExperimentUpdate: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("experiments:view")
    .subscription(async function* (opts) {
      const { projectId } = opts.input;
      const emitter = getApp().broadcast.getTenantEmitter(projectId);
      try {
        for await (const eventArgs of on(emitter, "experiment_updated", {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- input-bearing subscriptions leave opts.signal untyped (same as langy/traces routers)
          signal: (opts as { signal?: AbortSignal }).signal,
        })) {
          yield eventArgs[0] as { event?: unknown; timestamp?: number };
        }
      } finally {
        getApp().broadcast.cleanupTenantEmitter(projectId);
      }
    }),

  listWorkbenchVersions: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.number().int().optional(),
      }),
    )
    .permission("experiments:view")
    .query(async ({ input }) => {
      const page = await experimentService()
        .listWorkbenchVersions({
          projectId: input.projectId,
          id: input.experimentId,
          limit: input.limit,
          cursor: input.cursor,
        })
        .catch(mapExperimentError);

      // The history names the person who saved each version, and the service
      // stores only their id. Resolved here rather than in the service because
      // it is a display concern: the REST surface publishes the id and lets
      // the caller decide, while this list is read straight into a drawer.
      const authorIds = [
        ...new Set(
          page.versions
            .map((version) => version.authorId)
            .filter((id): id is string => !!id),
        ),
      ];
      const authors =
        authorIds.length > 0
          ? await prisma.user.findMany({
              where: { id: { in: authorIds } },
              select: { id: true, name: true },
            })
          : [];
      const nameById = new Map(
        authors.map((author) => [author.id, author.name]),
      );

      return {
        ...page,
        versions: page.versions.map((version) => ({
          ...version,
          authorName: version.authorId
            ? (nameById.get(version.authorId) ?? null)
            : null,
        })),
      };
    }),

  commitWorkbenchVersion: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string(),
        commitMessage: z.string().min(1),
      }),
    )
    .permission("experiments:update")
    .mutation(async ({ ctx, input }) => {
      return await experimentService()
        .commitWorkbenchVersion({
          projectId: input.projectId,
          id: input.experimentId,
          commitMessage: input.commitMessage,
          actor: { userId: ctx.session?.user?.id, label: "user" },
        })
        .catch(mapExperimentError);
    }),

  restoreWorkbenchVersion: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string(),
        version: z.number().int().min(1),
      }),
    )
    .permission("experiments:update")
    .mutation(async ({ ctx, input }) => {
      return await experimentService()
        .restoreWorkbenchVersion({
          projectId: input.projectId,
          id: input.experimentId,
          version: input.version,
          actor: { userId: ctx.session?.user?.id, label: "user" },
        })
        .catch(mapExperimentError);
    }),

  saveAsMonitor: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string(),
      }),
    )
    .permission("workflows:create")
    .mutation(async ({ ctx, input }) => {
      const experiment = await ctx.app.experiments
        .getById({ projectId: input.projectId, id: input.experimentId })
        .catch(mapExperimentError);
      const workflow = experiment.workflowId
        ? await ctx.app.workflows
            .getById({
              id: experiment.workflowId,
              projectId: input.projectId,
              includeVersion: true,
            })
            .catch((error: unknown) => {
              if (error instanceof WorkflowNotFoundError) return null;
              throw error;
            })
        : null;

      const workbenchState = experiment.workbenchState as WizardState | undefined;
      const dsl = workflow?.currentVersion?.dsl as StudioWorkflow | undefined;
      const evaluator = dsl?.nodes.find((node) => node.type === "evaluator") as
        | Node<Evaluator>
        | undefined;

      if (!workbenchState || !dsl || !evaluator?.data.evaluator) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Experiment is not ready to be saved as a monitor",
        });
      }

      const monitorData = {
        name: experiment.name ?? "Unknown",
        checkType: evaluator.data.evaluator,
        slug: experiment.slug,
        preconditions: workbenchState.realTimeExecution?.preconditions ?? [],
        parameters: Object.fromEntries(
          (evaluator.data.parameters ?? []).map((param) => [
            param.identifier,
            param.value,
          ]),
        ) as Record<string, any>,
        mappings: coerceMonitorMappings(workbenchState.realTimeTraceMappings),
        sample: workbenchState.realTimeExecution?.sample ?? 1,
        enabled: true,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
      };

      const monitor = await prisma.monitor.upsert({
        where: {
          experimentId: input.experimentId,
          projectId: input.projectId,
        },
        update: monitorData,
        create: {
          ...monitorData,
          id: `monitor_${nanoid()}`,
          projectId: input.projectId,
          experimentId: input.experimentId,
        },
      });

      return monitor;
    }),

  getExperimentBySlugOrId: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string().optional(),
        experimentSlug: z.string().optional(),
      }),
    )
    .permission("experiments:view")
    .query(async ({ ctx, input }) => {
      if (input.experimentId) {
        return await ctx.app.experiments
          .getById({
            projectId: input.projectId,
            id: input.experimentId,
          })
          .catch(mapExperimentError);
      } else if (input.experimentSlug) {
        return await ctx.app.experiments
          .getBySlug({
            projectId: input.projectId,
            slug: input.experimentSlug,
          })
          .catch(mapExperimentError);
      }

      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Either experimentId or experimentSlug must be provided",
      });
    }),

  getExperimentWithDSLBySlug: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentSlug: z.string(),
        randomSeed: z.number().optional(),
      }),
    )
    .permission("experiments:view")
    .query(async ({ ctx, input }) => {
      const experiment = await ctx.app.experiments
        .getBySlug({
          projectId: input.projectId,
          slug: input.experimentSlug,
        })
        .catch(mapExperimentError);

      const workflow = experiment.workflowId
        ? await ctx.app.workflows
            .getById({
              id: experiment.workflowId,
              projectId: input.projectId,
              includeVersion: true,
            })
            .catch((error: unknown) => {
              if (error instanceof WorkflowNotFoundError) return null;
              throw error;
            })
        : undefined;

      return {
        ...experiment,
        workbenchState: experiment.workbenchState as WizardState | undefined,
        dsl: workflow?.currentVersion?.dsl
          ? parseStudioWorkflow(workflow.currentVersion.dsl)
          : undefined,
      };
    }),

  getAllByProjectId: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("experiments:view")
    .query(async ({ ctx, input }) => {
      return await ctx.app.experiments.list({
        projectId: input.projectId,
      });
    }),

  getAllForEvaluationsList: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        pageOffset: z.number().optional(),
        pageSize: z.number().optional(),
      }),
    )
    .permission("experiments:view")
    .query(async ({ input, ctx }) => {
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
              ? await ctx.app.workflows
                  .getById({
                    id: experiment.workflowId,
                    projectId: input.projectId,
                    includeVersion: true,
                  })
                  .catch((error: unknown) => {
                    if (error instanceof WorkflowNotFoundError) return null;
                    throw error;
                  })
              : null,
          }),
        ),
      );
      const nonLegacyExperiments = allExperiments.filter(
        (experiment) =>
          !isLegacyOnlineEvaluationWorkbenchState(experiment.workbenchState),
      );
      const totalHits = nonLegacyExperiments.length;

      // Apply pagination after excluding legacy online evaluations.
      const experiments = nonLegacyExperiments.slice(pageOffset, pageOffset + pageSize);

      const getDatasetId = (dsl: unknown) => {
        const parsed = studioWorkflowSchema.safeParse(dsl);
        if (!parsed.success) return undefined;
        return (parsed.data.nodes.find((node) => node.type === "entry") as Node<Entry>)
          ?.data.dataset?.id;
      };

      const datasetIds = experiments
        .map((experiment) => {
          return getDatasetId(experiment.workflow?.currentVersion?.dsl);
        })
        .filter(Boolean) as string[];

      const datasetsById = Object.fromEntries(
        (
          await ctx.app.dataset.getByIds({
            projectId: input.projectId,
            datasetIds,
          })
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
            ? Object.values(latestRun?.summary.evaluations)[0]
            : undefined;

          return {
            ...experiment,
            workbenchState: experiment.workbenchState as WizardState | undefined,
            runsSummary: {
              count: runs.length,
              primaryMetric,
              latestRun: {
                timestamps: latestRun?.timestamps,
              },
            },
            dataset:
              datasetsById[getDatasetId(experiment.workflow?.currentVersion?.dsl) ?? ""],
            updatedAt: latestRun?.timestamps.createdAt ?? experiment.updatedAt.getTime(),
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);

      return {
        experiments: experimentsWithDatasetsAndRuns,
        totalHits,
      };
    }),

  getExperimentDSPyRuns: protectedProcedure
    .input(z.object({ projectId: z.string(), experimentSlug: z.string() }))
    .permission("experiments:view")
    .query(async ({ ctx, input }) => {
      const experiment = await ctx.app.experiments
        .getBySlug({
          projectId: input.projectId,
          slug: input.experimentSlug,
        })
        .catch(mapExperimentError);

      return ctx.app.experiments.listDspyRuns({
        tenantId: input.projectId,
        experimentId: experiment.id,
      });
    }),

  getExperimentDSPyStep: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentSlug: z.string(),
        runId: z.string(),
        index: z.string(),
      }),
    )
    .permission("experiments:view")
    .query(async ({ ctx, input }) => {
      const experiment = await ctx.app.experiments
        .getBySlug({
          projectId: input.projectId,
          slug: input.experimentSlug,
        })
        .catch(mapExperimentError);

      try {
        const step = await ctx.app.experiments.getDspyStep({
          tenantId: input.projectId,
          experimentId: experiment.id,
          runId: input.runId,
          stepIndex: input.index,
        });

        // Map camelCase domain type to snake_case DSPyStep for frontend
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
            parameters: step.optimizerParameters as Record<string, any>,
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
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "DSPy step not found",
          });
        }
        throw error;
      }
    }),

  getExperimentBatchEvaluationRuns: protectedProcedure
    .input(z.object({ projectId: z.string(), experimentId: z.string() }))
    .permission("experiments:view")
    .query(async ({ ctx, input }) => {
      const experiment = await ctx.app.experiments
        .getById({
          projectId: input.projectId,
          id: input.experimentId,
        })
        .catch(mapExperimentError);

      const runsByExperimentId = await ctx.app.experiments.listRuns({
        projectId: input.projectId,
        experimentIds: [experiment.id],
      });

      return { runs: runsByExperimentId[experiment.id] ?? [] };
    }),

  getExperimentBatchEvaluationRun: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string(),
        runId: z.string(),
      }),
    )
    .permission("experiments:view")
    .query(async ({ ctx, input }) => {
      const experiment = await ctx.app.experiments
        .getById({
          projectId: input.projectId,
          id: input.experimentId,
        })
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
   * requests alone and tripping AWS Cost Anomaly Detection on heavy days
   * (e.g. May 27 2026: 42 deletes -> 14,725 part rewrites).
   *
   * The Experiment model now matches the pattern used everywhere else in
   * this schema (Workflow, Monitor, Dataset, Evaluator, Agent, Project,
   * Team, etc.): archive via `archivedAt`, hide from list queries, leave
   * the historical data in place. Once retention TTL ships, archived rows
   * age out of ClickHouse naturally without a per-click S3 burst.
   *
   * The tRPC name remains `deleteExperiment` so the UI does not need to
   * change; the user-visible behaviour is identical (item disappears from
   * the list) but the platform cost drops to zero per click.
   */
  deleteExperiment: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string(),
      }),
    )
    .permission("workflows:delete")
    .mutation(async ({ ctx, input }) => {
      const experiment = await ctx.app.experiments.tryGetById({
        projectId: input.projectId,
        id: input.experimentId,
      });
      const result = await ctx.app.experiments
        .archive({ projectId: input.projectId, id: input.experimentId })
        .catch(mapExperimentError);
      if (experiment?.workflowId) {
        await ctx.app.workflows.archive({
          id: experiment.workflowId,
          projectId: input.projectId,
        });
      }
      if (experiment) {
        await ctx.app.monitors.deleteForExperiment({
          projectId: input.projectId,
          experimentId: input.experimentId,
        });
      }
      return result;
    }),

  copy: protectedProcedure
    .input(
      z.object({
        experimentId: z.string(),
        projectId: z.string(),
        sourceProjectId: z.string(),
        copyDatasets: z.boolean().optional(),
      }),
    )
    .permission("evaluations:manage")
    .mutation(async ({ ctx, input }) => {
      // Check that the user has at least evaluations:manage permission on the source project
      const hasSourcePermission = await probeProjectPermission(
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
        .getById({
          projectId: input.sourceProjectId,
          id: input.experimentId,
        })
        .catch(mapExperimentError);

      // Handle V3 experiments (no workflow, state stored in workbenchState)
      if (experiment.type === ExperimentType.EVALUATIONS_V3) {
        return await copyEvaluationsV3Experiment({
          ctx,
          experiment,
          targetProjectId: input.projectId,
          sourceProjectId: input.sourceProjectId,
          copyDatasets: input.copyDatasets,
        });
      }

      // V2 experiments require a workflow
      if (!experiment.workflowId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Experiment workflow not found",
        });
      }
      const sourceWorkflow = await ctx.app.workflows
        .getById({
          id: experiment.workflowId,
          projectId: input.sourceProjectId,
          includeVersion: true,
        })
        .catch((error: unknown) => {
          if (error instanceof WorkflowNotFoundError) return null;
          throw error;
        });
      if (!sourceWorkflow?.latestVersion?.dsl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Experiment workflow not found",
        });
      }

      const { workflowId, dsl } = await copyWorkflowWithDatasets({
        ctx,
        workflow: {
          id: sourceWorkflow.id,
          name: sourceWorkflow.name,
          icon: sourceWorkflow.icon,
          description: sourceWorkflow.description,
          isEvaluator: sourceWorkflow.isEvaluator,
          isComponent: sourceWorkflow.isComponent,
          latestVersion: {
            ...sourceWorkflow.latestVersion,
            dsl: z.json().parse(sourceWorkflow.latestVersion.dsl),
          },
        },
        targetProjectId: input.projectId,
        sourceProjectId: input.sourceProjectId,
        copyDatasets: input.copyDatasets,
        copiedFromWorkflowId: experiment.workflowId,
      });

      const newWorkflow = await ctx.prisma.workflow.findFirst({
        where: {
          id: workflowId,
          projectId: input.projectId,
        },
      });

      if (!newWorkflow) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create workflow",
        });
      }

      // Save workflow version
      await saveOrCommitWorkflowVersion({
        ctx,
        input: {
          projectId: input.projectId,
          workflowId,
          dsl,
        },
        autoSaved: false,
        commitMessage: `Copied from ${sourceWorkflow.name}`,
      });

      // Create new experiment with unique slug
      const experimentName = experiment.name ?? experiment.slug;
      const newExperiment = await ctx.app.experiments.save({
        id: `experiment_${nanoid()}`,
        name: experimentName,
        requestedSlug: slugify(experimentName),
        slugMode: "deduplicate",
        projectId: input.projectId,
        type: experiment.type,
        workflowId,
        workbenchState: experiment.workbenchState,
      });

      return { experiment: newExperiment, workflow: newWorkflow };
    }),

  /**
   * isLastExperimentADraft
   */
  getLastExperiment: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("experiments:view")
    .query(async ({ ctx, input }) => {
      return await ctx.app.experiments.tryGetLatest({
        projectId: input.projectId,
      });
    }),
});

/**
 * Copies an EVALUATIONS_V3 experiment to another project.
 * V3 experiments store their state in workbenchState (no workflow).
 * Optionally copies saved datasets and updates references.
 */
const copyEvaluationsV3Experiment = async ({
  ctx,
  experiment,
  targetProjectId,
  sourceProjectId,
  copyDatasets,
}: {
  ctx: TRPCContext;
  experiment: {
    id: string;
    name: string | null;
    slug: string;
    type: ExperimentType;
    workbenchState: JsonValue;
  };
  targetProjectId: string;
  sourceProjectId: string;
  copyDatasets?: boolean;
}) => {
  // Deep clone the workbenchState
  const workbenchState = JSON.parse(
    JSON.stringify(experiment.workbenchState ?? {}),
  ) as Record<string, unknown>;

  // Clear execution results (don't copy them to new project)
  delete workbenchState.results;

  // Process datasets if copyDatasets is enabled
  if (copyDatasets && Array.isArray(workbenchState.datasets)) {
    const datasetIdMap: Record<string, string> = {};

    // Copy saved datasets and build ID mapping
    for (const dataset of workbenchState.datasets as Array<{
      id: string;
      type: string;
      datasetId?: string;
    }>) {
      if (dataset.type === "saved" && dataset.datasetId) {
        try {
          const newDataset = await ctx.app.dataset.copyDataset({
            sourceDatasetId: dataset.datasetId,
            sourceProjectId,
            targetProjectId,
          });
          datasetIdMap[dataset.datasetId] = newDataset.id;
        } catch {
          // If dataset copy fails (e.g., not found), keep original reference
          continue;
        }
      }
    }

    // Update dataset references in workbenchState
    for (const dataset of workbenchState.datasets as Array<{
      id: string;
      type: string;
      datasetId?: string;
    }>) {
      if (
        dataset.type === "saved" &&
        dataset.datasetId &&
        datasetIdMap[dataset.datasetId]
      ) {
        dataset.datasetId = datasetIdMap[dataset.datasetId];
      }
    }
  }

  // Generate unique slug for the new experiment
  const experimentName = experiment.name ?? experiment.slug;
  const newExperiment = await ctx.app.experiments.save({
    id: generate("eval").toString(),
    name: experimentName,
    requestedSlug: slugify(experimentName),
    slugMode: "deduplicate",
    projectId: targetProjectId,
    type: ExperimentType.EVALUATIONS_V3,
    workflowId: null,
    workbenchState: z.json().parse(workbenchState),
  });

  return { experiment: newExperiment, workflow: null };
};
