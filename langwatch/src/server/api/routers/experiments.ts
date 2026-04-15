import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import { generate } from "@langwatch/ksuid";
import {
  EvaluationExecutionMode,
  ExperimentType,
  type Prisma,
} from "@prisma/client";
import type { JsonValue } from "@prisma/client/runtime/library";
import { TRPCError } from "@trpc/server";
import { ExperimentNotFoundError } from "../../experiments/errors";
import { ExperimentService } from "../../experiments/experiment.service";
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
import { getClickHouseClientForProject } from "../../clickhouse/clickhouseClient";
import { DatasetService } from "../../datasets/dataset.service";
import { prisma } from "../../db";
import {
  BATCH_EVALUATION_INDEX,
  esClient,
} from "../../elasticsearch";
import { getApp } from "../../app-layer/app";
import { DspyStepNotFoundError } from "../../app-layer/dspy-steps/errors";
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

/** Maps experiment domain errors to TRPCError. */
const mapExperimentError = (error: unknown): never => {
  if (error instanceof ExperimentNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  throw error;
};

/** Module-level service for query procedures that don't have ctx.prisma. */
const experimentService = ExperimentService.create(prisma);

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
      const experimentService = ExperimentService.create(ctx.prisma);

      // Enforce experiment limit only when creating new experiments
      if (!input.experimentId) {
        await enforceLicenseLimit(ctx, input.projectId, "experiments");
      }

      let workflowId = input.dsl.workflow_id;
      const name =
        input.workbenchState.name ??
        (await experimentService.findNextDraftName({
          projectId: input.projectId,
        }));
      const slug = await experimentService.generateUniqueSlug({
        baseSlug: slugify(name),
        projectId: input.projectId,
        excludeExperimentId: input.experimentId,
      });

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

      await experimentService.saveWithSlugRetry({
        initialSlug: slug,
        execute: (s) => {
          const data = {
            name,
            slug: s,
            projectId: input.projectId,
            type: ExperimentType.BATCH_EVALUATION_V2,
            workflowId,
            workbenchState: input.workbenchState,
          };
          return prisma.experiment.upsert({
            where: { id: experimentId, projectId: input.projectId },
            update: data,
            create: { ...data, id: experimentId },
          });
        },
        regenerateSlug: () =>
          experimentService.generateUniqueSlug({
            baseSlug: slugify(name),
            projectId: input.projectId,
            excludeExperimentId: input.experimentId,
          }),
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
      const experimentService = ExperimentService.create(ctx.prisma);
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

      // For new experiments, deduplicate the slug to avoid constraint violations
      // For existing experiments, keep the same slug to avoid breaking URLs
      const name =
        input.state.name ||
        (await experimentService.findNextDraftName({
          projectId: input.projectId,
        }));

      const rawSlug = input.state.experimentSlug ?? experimentId.slice(-8);
      let slug: string;
      if (isNewExperiment) {
        slug = await experimentService.generateUniqueSlug({
          baseSlug: rawSlug,
          projectId: input.projectId,
        });
      } else {
        slug = existing.slug;
      }

      // Convert to plain JSON for Prisma storage
      const workbenchStateJson = JSON.parse(JSON.stringify(input.state));

      await experimentService.saveWithSlugRetry({
        initialSlug: slug,
        execute: (s) => {
          const data = {
            name,
            slug: s,
            projectId: input.projectId,
            type: ExperimentType.EVALUATIONS_V3,
            workbenchState: workbenchStateJson,
          };
          return prisma.experiment.upsert({
            where: { id: experimentId, projectId: input.projectId },
            update: data,
            create: { ...data, id: experimentId },
          });
        },
        regenerateSlug: () =>
          experimentService.generateUniqueSlug({
            baseSlug: rawSlug,
            projectId: input.projectId,
          }),
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
      const experiment = await experimentService
        .getBySlug({
          projectId: input.projectId,
          slug: input.experimentSlug,
        })
        .catch(mapExperimentError);

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
        return await experimentService
          .getById({
            projectId: input.projectId,
            id: input.experimentId,
          })
          .catch(mapExperimentError);
      } else if (input.experimentSlug) {
        return await experimentService
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
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ input }) => {
      const experiment = await experimentService
        .getBySlug({
          projectId: input.projectId,
          slug: input.experimentSlug,
        })
        .catch(mapExperimentError);

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
      const experiment = await experimentService
        .getBySlug({
          projectId: input.projectId,
          slug: input.experimentSlug,
        })
        .catch(mapExperimentError);

      const steps = await getApp().dspySteps.steps.getStepsByExperiment({
        tenantId: input.projectId,
        experimentId: experiment.id,
      });

      const versionIds = steps
        .map((s) => s.workflowVersionId)
        .filter((id): id is string => Boolean(id));

      const versionsMap = await getVersionMap({ prisma, projectId: input.projectId, versionIds });

      // Group by runId
      const runMap = new Map<string, typeof steps>();
      for (const step of steps) {
        let group = runMap.get(step.runId);
        if (!group) {
          group = [];
          runMap.set(step.runId, group);
        }
        group.push(step);
      }

      const result: DSPyRunsSummary[] = Array.from(runMap.entries())
        .map(([runId, runSteps]) => {
          const versionId = runSteps.find((s) => s.workflowVersionId)?.workflowVersionId;
          return {
            runId,
            workflow_version: (versionId ? versionsMap[versionId] : undefined) as DSPyRunsSummary["workflow_version"],
            steps: runSteps
              .map((s) => ({
                run_id: s.runId,
                index: s.stepIndex,
                score: s.score,
                label: s.label,
                optimizer: { name: s.optimizerName },
                llm_calls_summary: {
                  total: s.llmCallsTotal,
                  total_tokens: s.llmCallsTotalTokens,
                  total_cost: s.llmCallsTotalCost,
                },
                timestamps: { created_at: s.createdAt },
              } as DSPyStepSummary))
              .sort((a, b) => a.timestamps.created_at - b.timestamps.created_at),
            created_at: Math.min(...runSteps.map((s) => s.createdAt)),
          };
        })
        .sort((a, b) => b.created_at - a.created_at);

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
      const experiment = await experimentService
        .getBySlug({
          projectId: input.projectId,
          slug: input.experimentSlug,
        })
        .catch(mapExperimentError);

      try {
        const step = await getApp().dspySteps.steps.getStep({
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
        if (error instanceof DspyStepNotFoundError) {
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
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ input }) => {
      const experiment = await experimentService
        .getById({
          projectId: input.projectId,
          id: input.experimentId,
        })
        .catch(mapExperimentError);

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
      const experiment = await experimentService
        .getById({
          projectId: input.projectId,
          id: input.experimentId,
        })
        .catch(mapExperimentError);

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
      }).catch((err) => {
        console.error("Best-effort ES cleanup failed for experiment deletion", { experimentId: input.experimentId, err });
      });

      const chCleanup = Promise.resolve().then(async () => {
        const chClient = await getClickHouseClientForProject(input.projectId);
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

      const dspyCleanup = getApp().dspySteps.steps
        .deleteByExperiment({ tenantId: input.projectId, experimentId: input.experimentId })
        .catch((err) => {
          console.error("Best-effort DSPy step cleanup failed for experiment deletion", { experimentId: input.experimentId, err });
        });

      await Promise.allSettled([esCleanup, chCleanup, dspyCleanup]);

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
      const copyService = ExperimentService.create(ctx.prisma);
      const initialSlug = await copyService.generateUniqueSlug({
        baseSlug: slugify(experimentName),
        projectId: input.projectId,
      });

      const { result: newExperiment } = await copyService.saveWithSlugRetry({
        initialSlug,
        execute: (s) =>
          ctx.prisma.experiment.create({
            data: {
              id: `experiment_${nanoid()}`,
              name: experimentName,
              slug: s,
              projectId: input.projectId,
              type: experiment.type,
              workflowId,
              ...(experiment.workbenchState && {
                workbenchState:
                  experiment.workbenchState as Prisma.InputJsonValue,
              }),
            },
          }),
        regenerateSlug: () =>
          copyService.generateUniqueSlug({
            baseSlug: slugify(experimentName),
            projectId: input.projectId,
          }),
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
      return await experimentService.getLatest({
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
  const copyService = ExperimentService.create(ctx.prisma);
  const initialSlug = await copyService.generateUniqueSlug({
    baseSlug: slugify(experimentName),
    projectId: targetProjectId,
  });

  const { result: newExperiment } = await copyService.saveWithSlugRetry({
    initialSlug,
    execute: (s) =>
      ctx.prisma.experiment.create({
        data: {
          id: generate("eval").toString(),
          name: experimentName,
          slug: s,
          projectId: targetProjectId,
          type: ExperimentType.EVALUATIONS_V3,
          workbenchState: workbenchState as Prisma.InputJsonValue,
        },
      }),
    regenerateSlug: () =>
      copyService.generateUniqueSlug({
        baseSlug: slugify(experimentName),
        projectId: targetProjectId,
      }),
  });

  return { experiment: newExperiment, workflow: null };
};
