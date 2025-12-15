import { type Project, type Trigger, TriggerAction } from "@prisma/client";
import { timeseries } from "~/server/analytics/timeseries";
import { prisma } from "~/server/db";
import type { Trace } from "~/server/tracer/types";
import { captureException } from "~/utils/posthogErrorCapture";
import { handleSendEmail } from "./actions/sendEmail";
import { handleSendSlackMessage } from "./actions/sendSlackMessage";
import type { ActionParams, TriggerData, TriggerResult } from "./types";
import { checkThreshold, updateAlert } from "./utils";

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

  const params = actionParams as any;
  const { threshold, operator, timePeriod } = params;

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

const calculateCurrentValue = (timeseriesResult: any, series: any): number => {
  let currentValue = 0;

  // Handle the structure: { previousPeriod: [...], currentPeriod: [...] }
  const dataPoints = timeseriesResult?.currentPeriod || [];

  if (dataPoints.length > 0) {
    const values = dataPoints
      .map((entry: any) => {
        // Try to find the value by series name first
        if (entry[series.name] !== undefined) {
          return entry[series.name];
        }

        // If not found, look for the first numeric value (excluding 'date')
        for (const [key, value] of Object.entries(entry)) {
          if (key !== "date" && typeof value === "number") {
            return value;
          }
        }

        return 0;
      })
      .filter((v: any) => typeof v === "number");

    if (values.length > 0) {
      // Use sum for count/cardinality, average for others
      if (
        series.aggregation === "count" ||
        series.aggregation === "cardinality"
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
