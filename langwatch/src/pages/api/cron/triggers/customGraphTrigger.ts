import {
  type Project,
  type Trigger,
  TriggerAction,
  Prisma,
} from "@prisma/client";
import { timeseries } from "~/server/analytics/timeseries";
import type {
  SeriesInputType,
  TimeseriesInputType,
} from "~/server/analytics/registry";
import type { CustomGraphInput } from "~/components/analytics/CustomGraph";
import { prisma } from "~/server/db";
import type { Trace } from "~/server/tracer/types";
import { captureException } from "~/utils/posthogErrorCapture";
import { handleSendEmail } from "./actions/sendEmail";
import { handleSendSlackMessage } from "./actions/sendSlackMessage";
import type { ActionParams, TriggerData, TriggerResult } from "./types";
import { addTriggersSent, checkThreshold, updateAlert } from "./utils";

// Graph config stored in database (subset of CustomGraphInput)
type StoredGraphConfig = Pick<
  CustomGraphInput,
  "series" | "groupBy" | "groupByKey" | "timeScale"
>;

// Types for timeseries results (no existing type found, so we define it)
interface TimeseriesBucket {
  date: string;
  [seriesName: string]: string | number;
}

interface TimeseriesResult {
  previousPeriod: TimeseriesBucket[];
  currentPeriod: TimeseriesBucket[];
}

export const processCustomGraphTrigger = async (
  trigger: Trigger,
  projects: Project[]
): Promise<TriggerResult> => {
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

  const params = actionParams as unknown as ActionParams;

  if (!params) {
    return {
      triggerId,
      status: "error",
      message: "ActionParams is missing from trigger",
    };
  }

  const { threshold, operator, timePeriod, seriesName } = params;

  if (
    threshold === undefined ||
    operator === undefined ||
    timePeriod === undefined
  ) {
    return {
      triggerId,
      status: "error",
      message:
        "Missing required fields in ActionParams: threshold, operator, or timePeriod",
    };
  }

  try {
    // Fetch the custom graph
    const customGraph = await prisma.customGraph.findUnique({
      where: { id: customGraphId, projectId: projectId },
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
    const graphData = customGraph.graph as unknown as StoredGraphConfig;

    if (!graphData || !graphData.series || graphData.series.length === 0) {
      return {
        triggerId,
        status: "error",
        message: "No series found in graph",
      };
    }

    if (!seriesName) {
      return {
        triggerId,
        status: "error",
        message: "seriesName is required in ActionParams",
      };
    }

    // Find the series to monitor based on seriesName
    // seriesName format: "index/key/aggregation" (e.g., "0/metadata.trace_id/cardinality")
    const [indexStr] = seriesName.split("/");
    const seriesIndex = parseInt(indexStr ?? "0", 10);

    if (
      isNaN(seriesIndex) ||
      seriesIndex < 0 ||
      seriesIndex >= graphData.series.length
    ) {
      return {
        triggerId,
        status: "error",
        message: `Series index ${seriesIndex} not found in graph (has ${graphData.series.length} series)`,
      };
    }

    const series = graphData.series[seriesIndex]!;

    if (!series || !series.name || !series.metric || !series.aggregation) {
      return {
        triggerId,
        status: "error",
        message: "Invalid series configuration in graph",
      };
    }

    // Build timeseries input
    const seriesInput: SeriesInputType = {
      metric: series.metric as SeriesInputType["metric"],
      aggregation: series.aggregation as SeriesInputType["aggregation"],
      key: series.key,
      subkey: series.subkey,
      pipeline: series.pipeline as SeriesInputType["pipeline"],
      filters: series.filters as SeriesInputType["filters"],
      asPercent: series.asPercent,
    };

    const timeseriesInput: TimeseriesInputType = {
      projectId,
      startDate: startDate.getTime(),
      endDate: endDate.getTime(),
      filters: (customGraph.filters as Prisma.JsonObject) ?? {},
      series: [seriesInput],
      groupBy: graphData.groupBy as TimeseriesInputType["groupBy"],
      timeScale: graphData.timeScale ?? 60,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    // Get analytics data
    const timeseriesResult = await timeseries(timeseriesInput);

    // Calculate current value (sum or average of the last period)
    // Use seriesName as the key to find the value in timeseries results
    const currentValue = calculateCurrentValue(
      timeseriesResult,
      series,
      seriesName
    );

    // Check threshold condition
    const conditionMet = checkThreshold(currentValue, threshold, operator);

    // Check if there's an unresolved alert (still firing)
    const unresolvedTriggerSent = await prisma.triggerSent.findFirst({
      where: {
        triggerId,
        projectId,
        customGraphId,
        resolvedAt: null, // Only look for unresolved alerts
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (conditionMet) {
      // Only send alert if this is a NEW incident (no unresolved TriggerSent)
      if (!unresolvedTriggerSent) {
        const project = projects.find((p) => p.id === projectId);

        if (!project) {
          return {
            triggerId,
            status: "error",
            message: "Project not found",
          };
        }

        // Create trigger data for notification
        const triggerData: TriggerData[] = [
          {
            input: `Graph: ${customGraph.name}`,
            output: `Current value: ${currentValue.toFixed(
              2
            )} (threshold: ${operator} ${threshold})`,
            graphId: customGraphId,
            projectId,
            fullTrace: {} as Trace,
          },
        ];

        const context = {
          trigger: {
            ...trigger,
            message:
              trigger.message ??
              `Graph "${customGraph.name}" alert: Value ${currentValue.toFixed(
                2
              )} ${operator} ${threshold}`,
          },
          projects,
          triggerData,
          projectSlug: project.slug,
        };

        // Execute the appropriate action
        if (action === TriggerAction.SEND_EMAIL) {
          await handleSendEmail(context);
        } else if (action === TriggerAction.SEND_SLACK_MESSAGE) {
          await handleSendSlackMessage(context);
        }

        // Record that this alert was sent (creates new TriggerSent with resolvedAt = null)
        await addTriggersSent(triggerId, triggerData);

        await updateAlert(triggerId, Date.now(), projectId);

        return {
          triggerId,
          status: "triggered",
          value: currentValue,
          threshold,
          operator,
        };
      } else {
        // Condition still met but alert already firing - just update lastRunAt
        await updateAlert(triggerId, Date.now(), projectId);

        return {
          triggerId,
          status: "already_firing",
          value: currentValue,
          threshold,
          operator,
        };
      }
    } else {
      // Condition not met - mark alert as resolved if it was firing
      if (unresolvedTriggerSent) {
        await prisma.triggerSent.update({
          where: { id: unresolvedTriggerSent.id },
          data: { resolvedAt: new Date() },
        });
      }

      await updateAlert(triggerId, Date.now(), projectId);

      return {
        triggerId,
        status: "not_triggered",
        value: currentValue,
        threshold,
        operator,
      };
    }
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

const calculateCurrentValue = (
  timeseriesResult: TimeseriesResult,
  series: CustomGraphInput["series"][number],
  seriesKey: string
): number => {
  let currentValue = 0;

  // Handle the structure: { previousPeriod: [...], currentPeriod: [...] }
  const dataPoints = timeseriesResult.currentPeriod;

  if (dataPoints.length > 0) {
    const values = dataPoints
      .map((entry) => {
        // Look up the value using the seriesKey (e.g., "0/metadata.trace_id/cardinality")
        const seriesValue = entry[seriesKey];
        if (typeof seriesValue === "number") {
          return seriesValue;
        }

        return 0;
      })
      .filter((v): v is number => typeof v === "number");

    if (values.length > 0) {
      // Use sum for cardinality/terms/count, average for others
      const aggregation = series.aggregation as string;
      if (
        aggregation === "cardinality" ||
        aggregation === "terms" ||
        aggregation === "count"
      ) {
        currentValue = values.reduce((a: number, b: number) => a + b, 0);
      } else {
        currentValue =
          values.reduce((a: number, b: number) => a + b, 0) / values.length;
      }
    }
  }

  return currentValue;
};
