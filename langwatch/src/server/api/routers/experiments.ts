import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import { generate } from "@langwatch/ksuid";
import {
  EvaluationExecutionMode,
  ExperimentType,
  type Prisma,
} from "@prisma/client";
import type { JsonValue } from "@prisma/client/runtime/library";
import { TRPCError } from "@trpc/server";
import type { Node } from "@xyflow/react";
import { nanoid } from "nanoid";
import { z } from "zod";
import { KSUID_RESOURCES } from "~/utils/constants";
import {
  type WizardState,
  workbenchStateSchema,
} from "../../../components/evaluations/wizard/hooks/evaluation-wizard-store/useEvaluationWizardStore";
import { persistedEvaluationsV3StateSchema } from "../../../evaluations-v3/types/persistence";
import {
  type Entry,
  type Evaluator,
  type Workflow,
  workflowJsonSchema,
} from "../../../optimization_studio/types/dsl";
import { slugify } from "../../../utils/slugify";
import { getClickHouseClient } from "../../clickhouse/client";
import { DatasetService } from "../../datasets/dataset.service";
import { prisma } from "../../db";
import {
  BATCH_EVALUATION_INDEX,
  DSPY_STEPS_INDEX,
  esClient,
} from "../../elasticsearch";
import { ExperimentRunService } from "../../evaluations-v3/services/experiment-run.service";
import { getVersionMap } from "../../evaluations-v3/services/getVersionMap";
import type {
  DSPyRunsSummary,
  DSPyStep,
  DSPyStepSummary,
  ESBatchEvaluation,
} from "../../experiments/types";
import { checkProjectPermission, hasProjectPermission } from "../rbac";
import {
  type createInnerTRPCContext,
  createTRPCRouter,
  protectedProcedure,
} from "../trpc";
import {
  copyWorkflowWithDatasets,
  saveOrCommitWorkflowVersion,
} from "./workflows";
import { enforceLicenseLimit } from "../../license-enforcement";

type TRPCContext = ReturnType<typeof createInnerTRPCContext>;

export const experimentsRouter = createTRPCRouter({
  saveExperiment: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string().optional(),
        workbenchState: workbenchStateSchema,
        dsl: workflowJsonSchema,
        commitMessage: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("workflows:create"))
    .mutation(async ({ ctx, input }) => {
      // Enforce experiment limit only when creating new experiments
      if (!input.experimentId) {
        await enforceLicenseLimit(ctx, input.projectId, "experiments");
      }

      let workflowId = input.dsl.workflow_id;
      const name =
        input.workbenchState.name ?? (await findNextDraftName(input.projectId));
      const slug = slugify(name);

      if (input.experimentId) {
        const currentExperiment = await prisma.experiment.findUnique({
          where: {
            id: input.experimentId,
            projectId: input.projectId,
          },
        });

        if (!currentExperiment) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Experiment not found",
          });
        }

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

          const datasets = await prisma.dataset.findMany({
            where: { id: { in: datasetIds }, projectId: input.projectId },
          });

          for (const dataset of datasets) {
            if (dataset.name.startsWith(currentExperiment.name)) {
              await prisma.dataset.update({
                where: { id: dataset.id, projectId: input.projectId },
                data: {
                  name: dataset.name.replace(currentExperiment.name, name),
                },
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
      const experimentData = {
        name,
        slug,
        projectId: input.projectId,
        type: ExperimentType.BATCH_EVALUATION_V2,
        workflowId,
        workbenchState: input.workbenchState,
      };

      await prisma.experiment.upsert({
        where: {
          id: experimentId,
          projectId: input.projectId,
        },
        update: experimentData,
        create: {
          ...experimentData,
          id: experimentId,
        },
      });

      // For some reason, prisma upsert sometimes return not an experiment but {count: 0}, so we need to refetch it
      const updatedExperiment = await prisma.experiment.findUnique({
        where: {
          id: experimentId,
          projectId: input.projectId,
        },
      });

      if (!updatedExperiment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Experiment not found",
        });
      }

      return updatedExperiment;
    }),

  saveEvaluationsV3: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string().optional(),
        state: persistedEvaluationsV3StateSchema,
      }),
    )
    .use(checkProjectPermission("workflows:create"))
    .mutation(async ({ ctx, input }) => {
      const experimentId =
        input.experimentId ?? generate(KSUID_RESOURCES.EXPERIMENT).toString();

      // Check if experiment actually exists in DB to determine if this is a create or update
      const existing = await prisma.experiment.findUnique({
        where: { id: experimentId, projectId: input.projectId },
        select: { slug: true },
      });
      const isNewExperiment = !existing;

      // Enforce experiment limit only when creating new experiments
      if (isNewExperiment) {
        await enforceLicenseLimit(ctx, input.projectId, "experiments");
      }

      // For new experiments, use the ID as the slug (guaranteed unique)
      // For existing experiments, keep the same slug to avoid breaking URLs
      const name =
        input.state.name || (await findNextDraftName(input.projectId));

      let slug: string;
      if (isNewExperiment) {
        // New experiment: prefer the slug from state (set by frontend redirect),
        // otherwise use last 8 chars of the ID for a shorter, cleaner URL
        slug = input.state.experimentSlug ?? experimentId.slice(-8);
      } else {
        // Existing experiment: keep the same slug to avoid breaking URLs
        slug = existing.slug;
      }

      // Convert to plain JSON for Prisma storage
      const workbenchStateJson = JSON.parse(JSON.stringify(input.state));
      const experimentData = {
        name,
        slug,
        projectId: input.projectId,
        type: ExperimentType.EVALUATIONS_V3,
        workbenchState: workbenchStateJson,
      };

      await prisma.experiment.upsert({
        where: {
          id: experimentId,
          projectId: input.projectId,
        },
        update: experimentData,
        create: {
          ...experimentData,
          id: experimentId,
        },
      });

      const updatedExperiment = await prisma.experiment.findUnique({
        where: {
          id: experimentId,
          projectId: input.projectId,
        },
      });

      if (!updatedExperiment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Experiment not found",
        });
      }

      return updatedExperiment;
    }),

  getEvaluationsV3BySlug: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentSlug: z.string(),
      }),
    )
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ input }) => {
      const experiment = await getExperimentBySlug(
        input.projectId,
        input.experimentSlug,
      );

      if (experiment.type !== ExperimentType.EVALUATIONS_V3) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Experiment is not an EVALUATIONS_V3 type",
        });
      }

      return {
        ...experiment,
        workbenchState: experiment.workbenchState as z.infer<
          typeof persistedEvaluationsV3StateSchema
        > | null,
      };
    }),

  saveAsMonitor: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string(),
      }),
    )
    .use(checkProjectPermission("workflows:create"))
    .mutation(async ({ input }) => {
      const experiment = await prisma.experiment.findUnique({
        where: {
          id: input.experimentId,
          projectId: input.projectId,
        },
        include: {
          workflow: {
            include: {
              currentVersion: true,
            },
          },
        },
      });

      if (!experiment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Experiment not found",
        });
      }

      const workbenchState = experiment.workbenchState as
        | WizardState
        | undefined;
      const dsl = experiment.workflow?.currentVersion?.dsl as
        | Workflow
        | undefined;
      const evaluator = dsl?.nodes.find((node) => node.type === "evaluator") as
        | Node<Evaluator>
        | undefined;

      if (!workbenchState || !dsl || !evaluator || !evaluator.data.evaluator) {
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
        mappings: workbenchState.realTimeTraceMappings ?? {},
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
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ input }) => {
      if (input.experimentId) {
        const experiment = await prisma.experiment.findFirst({
          where: {
            id: input.experimentId,
            projectId: input.projectId,
          },
        });

        if (!experiment) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Experiment not found",
          });
        }

        return experiment;
      } else if (input.experimentSlug) {
        const experiment = await getExperimentBySlug(
          input.projectId,
          input.experimentSlug,
        );

        return experiment;
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
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ input }) => {
      const experiment = await getExperimentBySlug(
        input.projectId,
        input.experimentSlug,
      );

      const workflow = experiment.workflowId
        ? await prisma.workflow.findUnique({
            where: {
              id: experiment.workflowId,
              projectId: input.projectId,
              archivedAt: null,
            },
            include: { currentVersion: true },
          })
        : undefined;

      return {
        ...experiment,
        workbenchState: experiment.workbenchState as WizardState | undefined,
        dsl: workflow?.currentVersion?.dsl as Workflow | undefined,
      };
    }),

  getAllByProjectId: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ input }) => {
      const experiments = await prisma.experiment.findMany({
        where: {
          projectId: input.projectId,
        },
      });

      return experiments;
    }),

  getAllForEvaluationsList: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        pageOffset: z.number().optional(),
        pageSize: z.number().optional(),
      }),
    )
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ input }) => {
      const pageOffset = input.pageOffset ?? 0;
      const pageSize = input.pageSize ?? 25;

      const baseWhereClause: Prisma.ExperimentWhereInput = {
        projectId: input.projectId,
      };

      // Helper to check if an experiment is a real_time evaluation (old wizard)
      const isRealTimeEvaluation = (workbenchState: JsonValue | null) => {
        if (!workbenchState || typeof workbenchState !== "object") return false;
        return (workbenchState as Record<string, unknown>).task === "real_time";
      };

      // Get total count for pagination (excluding real_time evaluations)
      const allExperimentsCount = await prisma.experiment.findMany({
        where: baseWhereClause,
        select: { workbenchState: true },
      });
      const totalHits = allExperimentsCount.filter(
        (e) => !isRealTimeEvaluation(e.workbenchState),
      ).length;

      // Fetch all experiments and filter/paginate in JS
      // (Prisma JSON path filtering is unreliable for nested fields)
      const allExperiments = await prisma.experiment.findMany({
        where: baseWhereClause,
        include: {
          workflow: {
            include: {
              currentVersion: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
      });

      // Filter out real_time evaluations and apply pagination
      const experiments = allExperiments
        .filter((e) => !isRealTimeEvaluation(e.workbenchState))
        .slice(pageOffset, pageOffset + pageSize);

      const getDatasetId = (dsl: JsonValue | undefined) => {
        return (
          (dsl as Workflow | undefined)?.nodes.find(
            (node) => node.type === "entry",
          ) as Node<Entry>
        )?.data.dataset?.id;
      };

      const datasetIds = experiments
        .map((experiment) => {
          return getDatasetId(experiment.workflow?.currentVersion?.dsl);
        })
        .filter(Boolean) as string[];

      const datasetsById = Object.fromEntries(
        (
          await prisma.dataset.findMany({
            select: {
              id: true,
              name: true,
            },
            where: { projectId: input.projectId, id: { in: datasetIds } },
          })
        ).map((dataset) => [dataset.id, dataset]),
      );

      const experimentRunService = ExperimentRunService.create(prisma);
      const runsByExperimentId = await experimentRunService.listRuns({
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
            workbenchState: experiment.workbenchState as
              | WizardState
              | undefined,
            runsSummary: {
              count: runs.length,
              primaryMetric,
              latestRun: {
                timestamps: latestRun?.timestamps,
              },
            },
            dataset:
              datasetsById[
                getDatasetId(experiment.workflow?.currentVersion?.dsl) ?? ""
              ],
            updatedAt:
              latestRun?.timestamps.createdAt ??
              experiment.updatedAt.getTime(),
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
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ input }) => {
      const experiment = await getExperimentBySlug(
        input.projectId,
        input.experimentSlug,
      );
      const client = await esClient({ projectId: input.projectId });

      const dspySteps = await client.search<DSPyStep>({
        index: DSPY_STEPS_INDEX.alias,
        size: 10_000,
        body: {
          query: {
            bool: {
              must: [
                { term: { experiment_id: experiment.id } },
                { term: { project_id: input.projectId } },
              ] as QueryDslBoolQuery["must"],
            } as QueryDslBoolQuery,
          },
          _source: [
            "run_id",
            "index",
            "score",
            "label",
            "workflow_version_id",
            "optimizer.name",
            "llm_calls.completion_tokens",
            "llm_calls.prompt_tokens",
            "llm_calls.cost",
            "timestamps.created_at",
          ],
          aggs: {
            runs: {
              terms: { field: "run_id", size: 1_000 },
            },
          },
        },
      });

      const versionIds = dspySteps.hits.hits
        .map((hit) => hit._source?.workflow_version_id)
        .filter((id): id is string => Boolean(id));

      const versionsMap = await getVersionMap({ prisma, projectId: input.projectId, versionIds });

      const result: DSPyRunsSummary[] = (
        dspySteps.aggregations?.runs as any
      ).buckets
        .map((bucket: any) => {
          const steps = dspySteps.hits.hits.filter(
            (hit) => hit._source?.run_id === bucket.key,
          );
          const versionId = steps.filter(
            (step) => step._source?.workflow_version_id,
          )[0]?._source?.workflow_version_id;

          return {
            runId: bucket.key,
            workflow_version: versionId ? versionsMap[versionId] : null,
            steps: steps
              .map((hit) => {
                const source = hit._source!;
                const llmCalls = source.llm_calls ?? [];

                return {
                  run_id: source.run_id,
                  index: source.index,
                  score: source.score,
                  label: source.label,
                  optimizer: {
                    name: source.optimizer.name,
                  },
                  llm_calls_summary: {
                    total: llmCalls.length,
                    total_tokens: llmCalls.reduce(
                      (acc, curr) =>
                        acc +
                        (curr.completion_tokens ?? 0) +
                        (curr.prompt_tokens ?? 0),
                      0,
                    ),
                    total_cost: llmCalls.reduce(
                      (acc, curr) => acc + (curr?.cost ?? 0),
                      0,
                    ),
                  },
                  timestamps: {
                    created_at: source.timestamps.created_at,
                  },
                } as DSPyStepSummary;
              })
              .sort(
                (a, b) => a.timestamps.created_at - b.timestamps.created_at,
              ),
            created_at: Math.min(
              ...steps.map((hit) => hit._source?.timestamps.created_at ?? 0),
            ),
          };
        })
        .sort(
          (a: DSPyRunsSummary, b: DSPyRunsSummary) =>
            b.created_at - a.created_at,
        );

      return result;
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
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ input }) => {
      const experiment = await getExperimentBySlug(
        input.projectId,
        input.experimentSlug,
      );

      const client = await esClient({ projectId: input.projectId });
      const dspyStep = await client.search<DSPyStep>({
        index: DSPY_STEPS_INDEX.alias,
        size: 10_000,
        body: {
          query: {
            bool: {
              must: [
                { term: { experiment_id: experiment.id } },
                { term: { project_id: input.projectId } },
                { term: { run_id: input.runId } },
                { term: { index: input.index } },
              ] as QueryDslBoolQuery["must"],
            } as QueryDslBoolQuery,
          },
        },
      });

      const result = dspyStep.hits.hits[0];
      if (!result?._source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "DSPy step not found",
        });
      }

      return result._source;
    }),

  getExperimentBatchEvaluationRuns: protectedProcedure
    .input(z.object({ projectId: z.string(), experimentId: z.string() }))
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ input }) => {
      const experiment = await getExperimentById(
        input.projectId,
        input.experimentId,
      );

      const experimentRunService = ExperimentRunService.create(prisma);
      const runsByExperimentId = await experimentRunService.listRuns({
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
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ input }) => {
      const experiment = await getExperimentById(
        input.projectId,
        input.experimentId,
      );

      const experimentRunService = ExperimentRunService.create(prisma);
      return experimentRunService.getRun({
        projectId: input.projectId,
        experimentId: experiment.id,
        runId: input.runId,
      });
    }),

  deleteExperiment: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string(),
      }),
    )
    .use(checkProjectPermission("workflows:delete"))
    .mutation(async ({ input }) => {
      // Verify the experiment exists and belongs to the project
      const experiment = await prisma.experiment.findUnique({
        where: {
          id: input.experimentId,
          projectId: input.projectId,
        },
      });

      if (!experiment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Experiment not found",
        });
      }

      // Perform the Prisma deletion in a transaction to ensure consistency
      await prisma.$transaction(async (tx) => {
        // Delete workflow versions if a workflow exists
        if (experiment.workflowId) {
          // First, update the workflow to null out the reference fields
          await tx.workflow.update({
            where: {
              id: experiment.workflowId,
              projectId: input.projectId,
            },
            data: {
              currentVersionId: null,
              latestVersionId: null,
            },
          });

          // Then we update all workflow versions to null out the parent field
          await tx.workflowVersion.updateMany({
            where: {
              workflowId: experiment.workflowId,
              projectId: input.projectId,
            },
            data: {
              parentId: null,
            },
          });

          // Now we can safely delete the workflow versions
          await tx.workflowVersion.deleteMany({
            where: {
              workflowId: experiment.workflowId,
              projectId: input.projectId,
            },
          });

          // Delete the workflow itself
          await tx.workflow.delete({
            where: {
              id: experiment.workflowId,
              projectId: input.projectId,
            },
          });
        }

        // Delete the monitor if it exists
        const monitor = await tx.monitor.findFirst({
          where: {
            experimentId: input.experimentId,
            projectId: input.projectId,
          },
        });

        if (monitor) {
          await tx.monitor.delete({
            where: {
              experimentId: input.experimentId,
              projectId: input.projectId,
            },
          });
        }

        // Finally, delete the experiment
        await tx.experiment.delete({
          where: {
            id: input.experimentId,
            projectId: input.projectId,
          },
        });
      });

      // Best-effort cleanup of ES and CH data outside the transaction
      // (these are not atomic with Prisma and should not cause rollback)
      const esCleanup = esClient({ projectId: input.projectId }).then(async (client) => {
        await client.deleteByQuery({
          index: BATCH_EVALUATION_INDEX.alias,
          body: {
            query: {
              bool: {
                must: [
                  { term: { experiment_id: input.experimentId } },
                  { term: { project_id: input.projectId } },
                ] as QueryDslBoolQuery["must"],
              } as QueryDslBoolQuery,
            },
          },
        });

        await client.deleteByQuery({
          index: DSPY_STEPS_INDEX.alias,
          body: {
            query: {
              bool: {
                must: [
                  { term: { experiment_id: input.experimentId } },
                  { term: { project_id: input.projectId } },
                ] as QueryDslBoolQuery["must"],
              } as QueryDslBoolQuery,
            },
          },
        });
      }).catch((err) => {
        console.error("Best-effort ES cleanup failed for experiment deletion", { experimentId: input.experimentId, err });
      });

      const chCleanup = Promise.resolve().then(async () => {
        const chClient = getClickHouseClient();
        if (!chClient) return;
        await Promise.all([
          chClient.command({
            query: `DELETE FROM experiment_runs WHERE TenantId = {tenantId:String} AND ExperimentId = {experimentId:String}`,
            query_params: {
              tenantId: input.projectId,
              experimentId: input.experimentId,
            },
          }),
          chClient.command({
            query: `DELETE FROM experiment_run_items WHERE TenantId = {tenantId:String} AND ExperimentId = {experimentId:String}`,
            query_params: {
              tenantId: input.projectId,
              experimentId: input.experimentId,
            },
          }),
        ]);
      }).catch((err) => {
        console.error("Best-effort CH cleanup failed for experiment deletion", { experimentId: input.experimentId, err });
      });

      await Promise.allSettled([esCleanup, chCleanup]);

      return { success: true };
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
    .use(checkProjectPermission("evaluations:manage"))
    .mutation(async ({ ctx, input }) => {
      // Enforce experiment limit - copy always creates a new experiment
      await enforceLicenseLimit(ctx, input.projectId, "experiments");

      // Check that the user has at least evaluations:manage permission on the source project
      const hasSourcePermission = await hasProjectPermission(
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

      const experiment = await ctx.prisma.experiment.findUnique({
        where: {
          id: input.experimentId,
          projectId: input.sourceProjectId,
        },
        include: {
          workflow: {
            include: {
              latestVersion: true,
            },
          },
        },
      });

      if (!experiment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Experiment not found",
        });
      }

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
      if (!experiment.workflowId || !experiment.workflow?.latestVersion?.dsl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Experiment workflow not found",
        });
      }

      const { workflowId, dsl } = await copyWorkflowWithDatasets({
        ctx,
        workflow: {
          id: experiment.workflow.id,
          name: experiment.workflow.name,
          icon: experiment.workflow.icon,
          description: experiment.workflow.description,
          latestVersion: experiment.workflow.latestVersion,
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
        commitMessage: `Copied from ${experiment.workflow.name}`,
      });

      // Create new experiment with unique slug
      const experimentName = experiment.name ?? experiment.slug;
      const baseSlug = slugify(experimentName);

      // Find a unique slug by appending -2, -3, etc. if needed
      const MAX_ATTEMPTS = 100;
      let newSlug = baseSlug;
      let index = 2;
      let attempts = 0;

      while (attempts < MAX_ATTEMPTS) {
        const existingExperiment = await ctx.prisma.experiment.findFirst({
          where: {
            projectId: input.projectId,
            slug: newSlug,
          },
        });

        if (!existingExperiment) {
          break;
        }

        newSlug = `${baseSlug}-${index}`;
        index++;
        attempts++;
      }

      // Fallback to random suffix if we hit the limit (should never happen in practice)
      if (attempts >= MAX_ATTEMPTS) {
        newSlug = `${baseSlug}-${nanoid(8)}`;
      }

      const newExperiment = await ctx.prisma.experiment.create({
        data: {
          id: `experiment_${nanoid()}`,
          name: experimentName,
          slug: newSlug,
          projectId: input.projectId,
          type: experiment.type,
          workflowId,
          ...(experiment.workbenchState && {
            workbenchState: experiment.workbenchState as Prisma.InputJsonValue,
          }),
        },
      });

      return { experiment: newExperiment, workflow: newWorkflow };
    }),

  /**
   * isLastExperimentADraft
   */
  getLastExperiment: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ input }) => {
      const experiment = await prisma.experiment.findFirst({
        where: { projectId: input.projectId },
        orderBy: { createdAt: "desc" },
      });

      return experiment;
    }),
});

const getExperimentBySlug = async (
  projectId: string,
  experimentSlug: string,
) => {
  const experiment = await prisma.experiment.findFirst({
    where: {
      projectId: projectId,
      slug: experimentSlug,
    },
  });

  if (!experiment) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Experiment not found",
    });
  }

  return experiment;
};

const getExperimentById = async (projectId: string, experimentId: string) => {
  const experiment = await prisma.experiment.findFirst({
    where: {
      projectId: projectId,
      id: experimentId,
    },
  });

  if (!experiment) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Experiment not found",
    });
  }

  return experiment;
};


const findNextDraftName = async (projectId: string) => {
  const experiments = await prisma.experiment.findMany({
    select: {
      name: true,
      slug: true,
    },
    where: {
      projectId: projectId,
      name: {
        startsWith: "Draft",
      },
    },
  });

  const slugs = new Set(
    (
      await prisma.experiment.findMany({
        select: { slug: true },
        where: { projectId: projectId },
      })
    ).map((e) => e.slug),
  );

  let draftName;
  let index = experiments.length + 1;
  while (true) {
    draftName = `Draft Evaluation (${index})`;
    if (!slugs.has(slugify(draftName))) {
      break;
    }
    index++;
  }

  return draftName;
};

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
    const datasetService = DatasetService.create(ctx.prisma);
    const datasetIdMap: Record<string, string> = {};

    // Copy saved datasets and build ID mapping
    for (const dataset of workbenchState.datasets as Array<{
      id: string;
      type: string;
      datasetId?: string;
    }>) {
      if (dataset.type === "saved" && dataset.datasetId) {
        try {
          const newDataset = await datasetService.copyDataset({
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
  const baseSlug = slugify(experimentName);

  const MAX_ATTEMPTS = 100;
  let newSlug = baseSlug;
  let index = 2;
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    const existingExperiment = await ctx.prisma.experiment.findFirst({
      where: {
        projectId: targetProjectId,
        slug: newSlug,
      },
    });

    if (!existingExperiment) {
      break;
    }

    newSlug = `${baseSlug}-${index}`;
    index++;
    attempts++;
  }

  // Fallback to random suffix if we hit the limit
  if (attempts >= MAX_ATTEMPTS) {
    newSlug = `${baseSlug}-${nanoid(8)}`;
  }

  // Create the new experiment
  const newExperiment = await ctx.prisma.experiment.create({
    data: {
      id: generate("eval").toString(),
      name: experimentName,
      slug: newSlug,
      projectId: targetProjectId,
      type: ExperimentType.EVALUATIONS_V3,
      workbenchState: workbenchState as Prisma.InputJsonValue,
    },
  });

  return { experiment: newExperiment, workflow: null };
};
