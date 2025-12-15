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
import { checkThreshold, updateAlert } from "./utils";

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
  projects: Project[],
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

  const { threshold, operator, timePeriod } = params;

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

    const series = graphData.series[0]; // Only one series allowed

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
    const currentValue = calculateCurrentValue(timeseriesResult, series);

    // Check threshold condition
    const conditionMet = checkThreshold(currentValue, threshold, operator);

    if (conditionMet) {
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
            2,
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
              2,
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

const calculateCurrentValue = (
  timeseriesResult: TimeseriesResult,
  series: CustomGraphInput["series"][number],
): number => {
  let currentValue = 0;

  // Handle the structure: { previousPeriod: [...], currentPeriod: [...] }
  const dataPoints = timeseriesResult.currentPeriod;

  if (dataPoints.length > 0) {
    const values = dataPoints
      .map((entry) => {
        // Try to find the value by series name first
        const seriesValue = entry[series.name];
        if (typeof seriesValue === "number") {
          return seriesValue;
        }

        // If not found, look for the first numeric value (excluding 'date')
        for (const [key, value] of Object.entries(entry)) {
          if (key !== "date" && typeof value === "number") {
            return value;
          }
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
