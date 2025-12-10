import { type Project, type Trigger, TriggerAction } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { timeseries } from "~/server/analytics/timeseries";
import { createOrUpdateQueueItems } from "~/server/api/routers/annotation";
import { createManyDatasetRecords } from "~/server/api/routers/datasetRecord";
import { getAllTracesForProject } from "~/server/api/routers/traces";
import type { DatasetRecordEntry } from "~/server/datasets/types";
import { sendTriggerEmail } from "~/server/mailer/triggerEmail";
import type { Trace } from "~/server/tracer/types";
import { sendSlackWebhook } from "~/server/triggers/sendSlackWebhook";
import { captureException } from "~/utils/posthogErrorCapture";
import { prisma } from "../../../server/db";
import {
  mapTraceToDatasetEntry,
  type TRACE_EXPANSIONS,
  type TraceMapping,
} from "../../../server/tracer/tracesMapping";

interface TraceGroups {
  groups: Trace[][];
}

interface ActionParams {
  members?: string[] | null;
  dataset?: string | null;
  slackWebhook?: string | null;
  datasetMapping: {
    mapping: Record<string, { source: string; key: string; subkey: string }>;
    expansions: Set<keyof typeof TRACE_EXPANSIONS>;
  };
  datasetId: string;
  annotators?: { id: string; name: string }[];
  createdByUserId?: string;
}

interface TriggerData {
  input: string;
  output: string;
  traceId: string;
  projectId: string;
  fullTrace: Trace;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).end();
  }

  let cronApiKey = req.headers.authorization;
  cronApiKey = cronApiKey?.startsWith("Bearer ")
    ? cronApiKey.slice(7)
    : cronApiKey;

  if (cronApiKey !== process.env.CRON_API_KEY) {
    return res.status(401).end();
  }

  const projects = await prisma.project.findMany({
    where: {
      firstMessage: true,
    },
  });

  const triggers = await prisma.trigger.findMany({
    where: {
      active: true,
      projectId: {
        in: projects.map((project) => project.id),
      },
    },
  });

  const results = [];

  for (const trigger of triggers) {
    // Check if this is a custom graph alert (has customGraphId)
    if (trigger.customGraphId) {
      const result = await getCustomGraphAlert(trigger, projects);
      results.push(result);
    } else {
      // Existing trace-based trigger logic
      const traces = await getTracesForAlert(trigger, projects);
      results.push(traces);
    }
  }

  return res.status(200).json(results);
}

const getTracesForAlert = async (trigger: Trigger, projects: Project[]) => {
  const {
    id: triggerId,
    projectId,
    filters,
    lastRunAt,
    action,
    actionParams,
    name,
  } = trigger;

  const parsedFilters = JSON.parse(filters as string);

  const input = {
    projectId,
    filters: parsedFilters,
    updatedAt: lastRunAt,
    startDate: new Date().getTime() - 1000 * 60 * 60 * 24,
    endDate: new Date().getTime(),
  };

  const traces = await getAllTracesForProject({
    input,
    ctx: {
      prisma: prisma,
      session: null,
      publiclyShared: false,
    },
  });

  const getTracesToSend = async (traces: TraceGroups, triggerId: string) => {
    const traceIds = traces.groups.flatMap((group) =>
      group.map((trace) => trace.trace_id),
    );

    const triggersSent = await triggerSentForMany(
      triggerId,
      traceIds,
      input.projectId,
    );

    const tracesToSend = traces.groups.filter((group) => {
      return group.every((trace) => {
        return !triggersSent.some((sent) => sent.traceId === trace.trace_id);
      });
    });

    return tracesToSend;
  };

  const tracesToSend = await getTracesToSend(traces, triggerId);

  if (tracesToSend.length > 0) {
    const triggerData: TriggerData[] = tracesToSend.flatMap((group) =>
      group.map((trace) => ({
        input: trace.input?.value ?? "",
        output: trace.output?.value ?? "",
        traceId: trace.trace_id,
        projectId: input.projectId,
        fullTrace: trace,
      })),
    );

    const project = projects.find((project) => project.id === input.projectId);

    let triggerInfo;
    let updatedAt = 0;

    if (action === TriggerAction.SEND_EMAIL) {
      try {
        triggerInfo = {
          triggerEmails:
            (actionParams as unknown as ActionParams)?.members ?? [],
          triggerData,
          triggerName: name,
          projectSlug: project!.slug,
          triggerType: trigger.alertType ?? null,
          triggerMessage: trigger.message ?? "",
        };

        await sendTriggerEmail(triggerInfo);
      } catch (error) {
        captureException(error, {
          extra: {
            triggerId,
            projectId: input.projectId,
            action: TriggerAction.SEND_EMAIL,
          },
        });
      }
    } else if (action === TriggerAction.SEND_SLACK_MESSAGE) {
      try {
        triggerInfo = {
          triggerWebhook:
            (actionParams as unknown as ActionParams)?.slackWebhook ?? "",
          triggerData,
          triggerName: name,
          projectSlug: project!.slug,
          triggerType: trigger.alertType ?? null,
          triggerMessage: trigger.message ?? "",
        };

        await sendSlackWebhook(triggerInfo);
      } catch (error) {
        captureException(error, {
          extra: {
            triggerId,
            projectId: input.projectId,
            action: TriggerAction.SEND_SLACK_MESSAGE,
          },
        });
      }
    } else if (action === TriggerAction.ADD_TO_ANNOTATION_QUEUE) {
      try {
        const trigger = await prisma.trigger.findUnique({
          where: { id: triggerId, projectId: input.projectId },
        });

        const actionParamsRaw =
          trigger?.actionParams as unknown as ActionParams;
        const { annotators, createdByUserId } = actionParamsRaw;

        await createQueueItems(triggerData, annotators ?? [], createdByUserId);
      } catch (error) {
        captureException(error, {
          extra: {
            triggerId,
            projectId: input.projectId,
            action: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
          },
        });
      }
    } else if (action === TriggerAction.ADD_TO_DATASET) {
      try {
        const trigger = await prisma.trigger.findUnique({
          where: { id: triggerId, projectId: input.projectId },
        });

        const actionParamsRaw =
          trigger?.actionParams as unknown as ActionParams;
        const { datasetId, datasetMapping } = actionParamsRaw;

        const { mapping, expansions: expansionsArray } = datasetMapping;
        const expansions = new Set(expansionsArray);

        const rowsToAdd = triggerData.map((trace) => trace.fullTrace);
        const now = Date.now();

        let index = 0;
        const entries: DatasetRecordEntry[] = [];

        for (const trace of rowsToAdd) {
          const mappedEntries = mapTraceToDatasetEntry(
            trace,
            mapping as TraceMapping,
            expansions,
            undefined,
            undefined,
          );

          for (const entry of mappedEntries) {
            const sanitizedEntry = Object.fromEntries(
              Object.entries(entry).map(([key, value]) => [
                key,
                typeof value === "string"
                  ? value.replace(/\u0000/g, "")
                  : value,
              ]),
            );
            entries.push({
              id: `${now}-${index}`,
              selected: true,
              ...sanitizedEntry,
            });
            index++;
          }
        }

        await createManyDatasetRecords({
          datasetId: datasetId,
          projectId: input.projectId,
          datasetRecords: entries,
        });

        triggerInfo = {
          triggerData,
          triggerName: name,
          projectSlug: project!.slug,
        };
      } catch (error) {
        captureException(error, {
          extra: {
            triggerId,
            projectId: input.projectId,
            action: TriggerAction.ADD_TO_DATASET,
          },
        });
      }
    }

    await addTriggersSent(triggerId, triggerData);
    updatedAt = getLatestUpdatedAt(traces);
    void updateAlert(triggerId, updatedAt, project?.id ?? "");

    return {
      triggerId,
      updatedAt: updatedAt,
      status: "triggered",
      totalFound: tracesToSend.length,
    };
  }

  return {
    triggerId,
    updatedAt: input.updatedAt,
    status: "not_triggered",
    traces: "null",
  };
};

const updateAlert = async (
  triggerId: string,
  updatedAt: number,
  projectId: string,
) => {
  await prisma.trigger.update({
    where: { id: triggerId, projectId },
    data: { lastRunAt: updatedAt },
  });
};

const addTriggersSent = async (
  triggerId: string,
  triggerData: TriggerData[],
) => {
  await prisma.triggerSent.createMany({
    data: triggerData.map((data) => ({
      triggerId: triggerId,
      traceId: data.traceId,
      projectId: data.projectId,
    })),
    skipDuplicates: true,
  });
};

const triggerSentForMany = async (
  triggerId: string,
  traceIds: string[],
  projectId: string,
) => {
  const triggerSent = await prisma.triggerSent.findMany({
    where: {
      triggerId,
      traceId: { in: traceIds },
      projectId,
    },
  });
  return triggerSent;
};

interface TraceGroups {
  groups: Trace[][];
}

export const getLatestUpdatedAt = (traces: TraceGroups) => {
  const updatedTimes = traces.groups
    .flatMap((group: any) =>
      group.map((item: any) => item.timestamps.updated_at),
    )
    .sort((a: number, b: number) => b - a);

  return updatedTimes[0];
};

const createQueueItems = async (
  triggerData: TriggerData[],
  annotators: { id: string; name: string }[],
  createdByUserId?: string,
) => {
  await Promise.all(
    triggerData.map((data) =>
      createOrUpdateQueueItems({
        traceIds: [data.traceId],
        projectId: data.projectId,
        annotators: annotators.map((annotator) => annotator.id),
        userId: createdByUserId ?? "",
        prisma: prisma,
      }),
    ),
  );
};

const getCustomGraphAlert = async (trigger: Trigger, projects: Project[]) => {
  const {
    id: triggerId,
    projectId,
    action,
    actionParams,
    name,
    customGraphId,
  } = trigger;

  if (!customGraphId) {
    return {
      triggerId,
      status: "error",
      message: "No customGraphId found",
    };
  }

  const params = actionParams as any;
  const { threshold, operator, timePeriod } = params;

  try {
    // Fetch the custom graph
    const customGraph = await prisma.customGraph.findUnique({
      where: { id: customGraphId },
    });

    if (!customGraph) {
      return {
        triggerId,
        status: "error",
        message: "Graph not found",
      };
    }

    // Calculate time window
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - timePeriod * 60 * 1000);

    // Parse graph configuration
    const graphData = customGraph.graph as any;
    const series = graphData.series?.[0]; // Only one series allowed

    if (!series) {
      return {
        triggerId,
        status: "error",
        message: "No series found in graph",
      };
    }

    // Build timeseries input
    const timeseriesInput = {
      projectId,
      startDate: startDate.getTime(),
      endDate: endDate.getTime(),
      filters: (customGraph.filters as any) ?? {},
      series: [
        {
          name: series.name,
          metric: series.metric,
          aggregation: series.aggregation,
          key: series.key,
          subkey: series.subkey,
          pipeline: series.pipeline,
          filters: series.filters,
          asPercent: series.asPercent,
        },
      ],
      groupBy: graphData.groupBy,
      timeScale: graphData.timeScale ?? 60,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    // Get analytics data
    const timeseriesResult = await timeseries(timeseriesInput);

    // Calculate current value (sum or average of the last period)
    let currentValue = 0;
    if (timeseriesResult && timeseriesResult.length > 0) {
      const values = timeseriesResult
        .map((entry: any) => {
          const seriesName = series.name;
          return entry[seriesName] ?? 0;
        })
        .filter((v: any) => typeof v === "number");

      if (values.length > 0) {
        // Use sum for count/cardinality, average for others
        if (series.aggregation === "count" || series.aggregation === "cardinality") {
          currentValue = values.reduce((a: number, b: number) => a + b, 0);
        } else {
          currentValue = values.reduce((a: number, b: number) => a + b, 0) / values.length;
        }
      }
    }

    // Check threshold condition
    const conditionMet = checkThreshold(currentValue, threshold, operator);

    if (conditionMet) {
      const project = projects.find((p) => p.id === projectId);

      // Create trigger data for notification
      const triggerData: TriggerData[] = [
        {
          input: `Graph: ${customGraph.name}`,
          output: `Current value: ${currentValue.toFixed(2)} (threshold: ${operator} ${threshold})`,
          traceId: `graph-${customGraphId}`,
          projectId,
          fullTrace: {} as Trace,
        },
      ];

      let triggerInfo;

      if (action === TriggerAction.SEND_EMAIL) {
        try {
          triggerInfo = {
            triggerEmails: (params as any)?.members ?? [],
            triggerData,
            triggerName: name,
            projectSlug: project!.slug,
            triggerType: trigger.alertType ?? null,
            triggerMessage: trigger.message ?? `Graph "${customGraph.name}" alert: Value ${currentValue.toFixed(2)} ${operator} ${threshold}`,
          };

          await sendTriggerEmail(triggerInfo);
        } catch (error) {
          captureException(error, {
            extra: {
              triggerId,
              projectId,
              action: TriggerAction.SEND_EMAIL,
            },
          });
        }
      } else if (action === TriggerAction.SEND_SLACK_MESSAGE) {
        try {
          triggerInfo = {
            triggerWebhook: (params as any)?.slackWebhook ?? "",
            triggerData,
            triggerName: name,
            projectSlug: project!.slug,
            triggerType: trigger.alertType ?? null,
            triggerMessage: trigger.message ?? `Graph "${customGraph.name}" alert: Value ${currentValue.toFixed(2)} ${operator} ${threshold}`,
          };

          await sendSlackWebhook(triggerInfo);
        } catch (error) {
          captureException(error, {
            extra: {
              triggerId,
              projectId,
              action: TriggerAction.SEND_SLACK_MESSAGE,
            },
          });
        }
      }

      await updateAlert(triggerId, Date.now(), projectId);

      return {
        triggerId,
        status: "triggered",
        value: currentValue,
        threshold,
        operator,
      };
    }

    await updateAlert(triggerId, Date.now(), projectId);

    return {
      triggerId,
      status: "not_triggered",
      value: currentValue,
      threshold,
      operator,
    };
  } catch (error) {
    captureException(error, {
      extra: {
        triggerId,
        projectId,
        type: "customGraphAlert",
      },
    });

    return {
      triggerId,
      status: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

const checkThreshold = (
  value: number,
  threshold: number,
  operator: string,
): boolean => {
  switch (operator) {
    case "gt":
      return value > threshold;
    case "lt":
      return value < threshold;
    case "gte":
      return value >= threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return Math.abs(value - threshold) < 0.0001; // Floating point comparison
    default:
      return false;
  }
};
