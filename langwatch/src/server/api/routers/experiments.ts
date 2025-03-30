import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import {
  EvaluationExecutionMode,
  ExperimentType,
  type Monitor,
} from "@prisma/client";
import type { JsonValue } from "@prisma/client/runtime/library";
import { TRPCError } from "@trpc/server";
import type { Node } from "@xyflow/react";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  wizardStateSchema,
  type WizardState,
} from "../../../components/evaluations/wizard/hooks/useEvaluationWizardStore";
import {
  workflowJsonSchema,
  type Entry,
  type Evaluator,
  type Workflow,
} from "../../../optimization_studio/types/dsl";
import { slugify } from "../../../utils/slugify";
import { prisma } from "../../db";
import {
  BATCH_EVALUATION_INDEX,
  batchEvaluationId,
  DSPY_STEPS_INDEX,
  esClient,
} from "../../elasticsearch";
import type {
  DSPyRunsSummary,
  DSPyStep,
  DSPyStepSummary,
  ESBatchEvaluation,
} from "../../experiments/types";
import { checkUserPermissionForProject, TeamRoleGroup } from "../permission";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { saveOrCommitWorkflowVersion } from "./workflows";

export const experimentsRouter = createTRPCRouter({
  saveExperiment: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string().optional(),
        wizardState: wizardStateSchema,
        dsl: workflowJsonSchema,
        commitMessage: z.string().optional(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      let workflowId = input.dsl.workflow_id;
      const name =
        input.wizardState.name ?? (await findNextDraftName(input.projectId));
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
        wizardState: input.wizardState,
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

  saveAsMonitor: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
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

      const wizardState = experiment.wizardState as WizardState | undefined;
      const dsl = experiment.workflow?.currentVersion?.dsl as
        | Workflow
        | undefined;
      const evaluator = dsl?.nodes.find((node) => node.type === "evaluator") as
        | Node<Evaluator>
        | undefined;

      if (!wizardState || !dsl || !evaluator || !evaluator.data.evaluator) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Experiment is not ready to be saved as a monitor",
        });
      }

      const monitorData = {
        name: `${experiment.name ?? "Unknown"} - Monitor`,
        checkType: evaluator.data.evaluator,
        slug: experiment.slug,
        preconditions: wizardState.realTimeExecution?.preconditions ?? [],
        parameters: Object.fromEntries(
          (evaluator.data.parameters ?? []).map((param) => [
            param.identifier,
            param.value,
          ])
        ) as Record<string, any>,
        mappings: wizardState.realTimeTraceMappings ?? {},
        sample: wizardState.realTimeExecution?.sample ?? 1,
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
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
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
          input.experimentSlug
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
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input }) => {
      const experiment = await getExperimentBySlug(
        input.projectId,
        input.experimentSlug
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
        wizardState: experiment.wizardState as WizardState | undefined,
        dsl: workflow?.currentVersion?.dsl as Workflow | undefined,
      };
    }),

  getAllByProjectId: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input }) => {
      const experiments = await prisma.experiment.findMany({
        where: {
          projectId: input.projectId,
        },
      });

      return experiments;
    }),

  getAllForEvaluationsList: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input }) => {
      const experiments = await prisma.experiment.findMany({
        where: { projectId: input.projectId },
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

      const getDatasetId = (dsl: JsonValue | undefined) => {
        return (
          (dsl as Workflow | undefined)?.nodes.find(
            (node) => node.type === "entry"
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
        ).map((dataset) => [dataset.id, dataset])
      );

      const runsByExperimentId = await getExperimentBatchEvaluationRuns(
        input.projectId,
        experiments.map((experiment) => experiment.id)
      );

      const experimentsWithDatasetsAndRuns = experiments
        .map((experiment) => {
          const runs = runsByExperimentId[experiment.id] ?? [];
          const latestRun = runs.sort(
            (a, b) => b.timestamps.created_at - a.timestamps.created_at
          )[0];
          const primaryMetric = latestRun
            ? Object.values(latestRun?.summary.evaluations)[0]
            : undefined;

          return {
            ...experiment,
            wizardState: experiment.wizardState as WizardState | undefined,
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
              latestRun?.timestamps.created_at ??
              experiment.updatedAt.getTime(),
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);

      return experimentsWithDatasetsAndRuns;
    }),

  getExperimentDSPyRuns: protectedProcedure
    .input(z.object({ projectId: z.string(), experimentSlug: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input }) => {
      const experiment = await getExperimentBySlug(
        input.projectId,
        input.experimentSlug
      );

      const dspySteps = await esClient.search<DSPyStep>({
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
        .map((hit) => {
          return hit._source!.workflow_version_id!;
        })
        .filter(Boolean);

      const versionsMap = await getVersionMap(input.projectId, versionIds);

      const result: DSPyRunsSummary[] = (
        dspySteps.aggregations!.runs as any
      ).buckets
        .map((bucket: any) => {
          const steps = dspySteps.hits.hits.filter(
            (hit) => hit._source!.run_id === bucket.key
          );
          const versionId = steps.filter(
            (step) => step._source!.workflow_version_id
          )[0]?._source!.workflow_version_id;

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
                      0
                    ),
                    total_cost: llmCalls.reduce(
                      (acc, curr) => acc + (curr?.cost ?? 0),
                      0
                    ),
                  },
                  timestamps: {
                    created_at: source.timestamps.created_at,
                  },
                } as DSPyStepSummary;
              })
              .sort(
                (a, b) => a.timestamps.created_at - b.timestamps.created_at
              ),
            created_at: Math.min(
              ...steps.map((hit) => hit._source!.timestamps.created_at)
            ),
          };
        })
        .sort(
          (a: DSPyRunsSummary, b: DSPyRunsSummary) =>
            b.created_at - a.created_at
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
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input }) => {
      const experiment = await getExperimentBySlug(
        input.projectId,
        input.experimentSlug
      );

      const dspyStep = await esClient.search<DSPyStep>({
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
    .input(z.object({ projectId: z.string(), experimentSlug: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input }) => {
      const experiment = await getExperimentBySlug(
        input.projectId,
        input.experimentSlug
      );

      const runsByExperimentId = await getExperimentBatchEvaluationRuns(
        input.projectId,
        [experiment.id]
      );

      return { runs: runsByExperimentId[experiment.id] ?? [] };
    }),

  getExperimentBatchEvaluationRun: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentSlug: z.string(),
        runId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input }) => {
      const experiment = await getExperimentBySlug(
        input.projectId,
        input.experimentSlug
      );

      const id = batchEvaluationId({
        projectId: input.projectId,
        experimentId: experiment.id,
        runId: input.runId,
      });

      const batchEvaluationRun = await esClient.get<ESBatchEvaluation>({
        index: BATCH_EVALUATION_INDEX.alias,
        id: id,
      });

      const result = batchEvaluationRun._source;
      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Batch evaluation run not found",
        });
      }

      return result;
    }),

  deleteExperiment: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
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

      // Perform the deletion in a transaction to ensure consistency
      await prisma.$transaction(async (tx) => {
        // Delete experiment-related data in Elasticsearch
        try {
          await esClient.deleteByQuery({
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

          // Delete DSPy steps in ES if applicable
          await esClient.deleteByQuery({
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
        } catch (error) {
          console.error("Error deleting Elasticsearch data:", error);
          // Continue with deletion even if ES deletion fails
        }

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
        await tx.monitor.delete({
          where: {
            experimentId: input.experimentId,
            projectId: input.projectId,
          },
        });

        // Finally, delete the experiment
        await tx.experiment.delete({
          where: {
            id: input.experimentId,
            projectId: input.projectId,
          },
        });
      });

      return { success: true };
    }),
});

const getExperimentBySlug = async (
  projectId: string,
  experimentSlug: string
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

const getVersionMap = async (projectId: string, versionIds: string[]) => {
  const versions = await prisma.workflowVersion.findMany({
    where: {
      projectId: projectId,
      id: {
        in: versionIds,
      },
    },
    select: {
      id: true,
      version: true,
      commitMessage: true,
      author: {
        select: {
          name: true,
          image: true,
        },
      },
    },
  });

  const versionsMap = versions.reduce(
    (acc, version) => {
      acc[version.id] = version;
      return acc;
    },
    {} as Record<string, (typeof versions)[number]>
  );

  return versionsMap;
};

const findNextDraftName = async (projectId: string) => {
  const experiments = await prisma.experiment.findMany({
    select: {
      name: true,
      slug: true,
    },
    where: {
      projectId: projectId,
    },
  });

  const draftCount = experiments.filter(
    (draft) => draft.name?.startsWith("Draft")
  ).length;

  const slugs = new Set(experiments.map((experiment) => experiment.slug));

  let draftName;
  let index = draftCount + 1;
  while (true) {
    draftName = `Draft Evaluation (${index})`;
    if (!slugs.has(slugify(draftName))) {
      break;
    }
    index++;
  }

  return draftName;
};

const getExperimentBatchEvaluationRuns = async (
  projectId: string,
  experimentIds: string[]
) => {
  type ESBatchEvaluationRunInfo = Pick<
    ESBatchEvaluation,
    | "experiment_id"
    | "run_id"
    | "workflow_version_id"
    | "timestamps"
    | "progress"
    | "total"
  >;

  const batchEvaluationRuns = await esClient.search<ESBatchEvaluationRunInfo>({
    index: BATCH_EVALUATION_INDEX.alias,
    size: 10_000,
    body: {
      _source: [
        "experiment_id",
        "run_id",
        "workflow_version_id",
        "timestamps.created_at",
        "timestamps.updated_at",
        "timestamps.finished_at",
        "timestamps.stopped_at",
        "progress",
        "total",
      ],
      query: {
        bool: {
          must: [
            { terms: { experiment_id: experimentIds } },
            { term: { project_id: projectId } },
          ] as QueryDslBoolQuery["must"],
        } as QueryDslBoolQuery,
      },
      sort: [{ "timestamps.created_at": "desc" }],
      aggs: {
        runs: {
          terms: { field: "run_id", size: 1_000 },
          aggs: {
            dataset_cost: {
              sum: {
                field: "dataset.cost",
              },
            },
            evaluations_cost: {
              nested: {
                path: "evaluations",
              },
              aggs: {
                cost: {
                  sum: {
                    field: "evaluations.cost",
                  },
                },
                average_cost: {
                  avg: {
                    field: "evaluations.cost",
                  },
                },
                average_duration: {
                  avg: {
                    field: "evaluations.duration",
                  },
                },
              },
            },
            dataset_average_cost: {
              avg: {
                field: "dataset.cost",
              },
            },
            dataset_average_duration: {
              avg: {
                field: "dataset.duration",
              },
            },
            evaluations: {
              nested: {
                path: "evaluations",
              },
              aggs: {
                child: {
                  terms: { field: "evaluations.evaluator", size: 100 },
                  aggs: {
                    name: {
                      terms: { field: "evaluations.name", size: 100 },
                    },
                    processed_evaluations: {
                      filter: {
                        term: { "evaluations.status": "processed" },
                      },
                      aggs: {
                        average_score: {
                          avg: {
                            field: "evaluations.score",
                          },
                        },
                        has_passed: {
                          filter: {
                            bool: {
                              should: [
                                { term: { "evaluations.passed": true } },
                                { term: { "evaluations.passed": false } },
                              ],
                            },
                          },
                        },
                        average_passed: {
                          avg: {
                            field: "evaluations.passed",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const versionIds = batchEvaluationRuns.hits.hits
    .map((hit) => {
      return hit._source!.workflow_version_id!;
    })
    .filter(Boolean);

  const versionsMap = await getVersionMap(projectId, versionIds);

  const runs = batchEvaluationRuns.hits.hits.map((hit) => {
    const source = hit._source!;

    const runAgg = (batchEvaluationRuns.aggregations!.runs as any).buckets.find(
      (bucket: any) => bucket.key === source.run_id
    );

    return {
      experiment_id: source.experiment_id,
      run_id: source.run_id,
      workflow_version: source.workflow_version_id
        ? versionsMap[source.workflow_version_id]
        : null,
      timestamps: source.timestamps,
      progress: source.progress,
      total: source.total,
      summary: {
        dataset_cost: runAgg?.dataset_cost.value as number | undefined,
        evaluations_cost: runAgg?.evaluations_cost.cost.value as
          | number
          | undefined,
        dataset_average_cost: runAgg?.dataset_average_cost.value as
          | number
          | undefined,
        dataset_average_duration: runAgg?.dataset_average_duration.value as
          | number
          | undefined,
        evaluations_average_cost: runAgg?.evaluations_cost.average_cost
          .value as number | undefined,
        evaluations_average_duration: runAgg?.evaluations_cost.average_duration
          .value as number | undefined,
        evaluations: Object.fromEntries(
          runAgg?.evaluations.child.buckets.map((bucket: any) => {
            return [
              bucket.key,
              {
                name: bucket.name.buckets[0].key ?? bucket.key,
                average_score: bucket.processed_evaluations.average_score.value,
                ...(bucket.processed_evaluations.has_passed.doc_count > 0
                  ? {
                      average_passed:
                        bucket.processed_evaluations.average_passed.value,
                    }
                  : {}),
              },
            ];
          })
        ) as Record<
          string,
          {
            name: string;
            average_score: number;
            average_passed?: number;
          }
        >,
      },
    };
  });

  const runsByExperimentId = runs.reduce(
    (acc, run) => {
      if (!(run.experiment_id in acc)) {
        acc[run.experiment_id] = [];
      }
      acc[run.experiment_id]!.push(run);
      return acc;
    },
    {} as Record<string, (typeof runs)[number][]>
  );

  return runsByExperimentId;
};
