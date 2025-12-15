import { type Project, type Trigger, TriggerAction } from "@prisma/client";
import { getAllTracesForProject } from "~/server/api/routers/traces";
import { prisma } from "~/server/db";
import { captureException } from "~/utils/posthogErrorCapture";
import { handleAddToAnnotationQueue } from "./actions/addToAnnotationQueue";
import { handleAddToDataset } from "./actions/addToDataset";
import { handleSendEmail } from "./actions/sendEmail";
import { handleSendSlackMessage } from "./actions/sendSlackMessage";
import type { TraceGroups, TriggerData, TriggerResult } from "./types";
import {
  addTriggersSent,
  getLatestUpdatedAt,
  triggerSentForMany,
  updateAlert,
} from "./utils";

export const processTraceBasedTrigger = async (
  trigger: Trigger,
  projects: Project[],
): Promise<TriggerResult> => {
  const {
    id: triggerId,
    projectId,
    filters,
    lastRunAt,
    action,
    name,
  } = trigger;

  let parsedFilters: Record<string, unknown>;
  try {
    parsedFilters = JSON.parse(filters as string);
  } catch (error) {
    captureException(error, {
      extra: {
        triggerId,
        projectId,
        triggerName: name,
        rawFilters: filters as string,
        type: "traceBasedTrigger",
        errorType: "JSONParseError",
      },
    });

    return {
      triggerId,
      status: "error",
      message: "Failed to parse trigger filters JSON",
    };
  }

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

  const tracesToSend = await getTracesToSend(
    traces,
    triggerId,
    input.projectId,
  );

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

    if (!project) {
      return {
        triggerId,
        status: "error",
        message: "Project not found",
      };
    }

    const context = {
      trigger,
      projects,
      triggerData,
      projectSlug: project.slug,
    };

    // Execute the appropriate action
    switch (action) {
      case TriggerAction.SEND_EMAIL:
        await handleSendEmail(context);
        break;
      case TriggerAction.SEND_SLACK_MESSAGE:
        await handleSendSlackMessage(context);
        break;
      case TriggerAction.ADD_TO_ANNOTATION_QUEUE:
        await handleAddToAnnotationQueue(context);
        break;
      case TriggerAction.ADD_TO_DATASET:
        await handleAddToDataset(context);
        break;
    }

    await addTriggersSent(triggerId, triggerData);
    const updatedAt = getLatestUpdatedAt(traces);
    void updateAlert(triggerId, updatedAt, project.id);

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
  };
};

const getTracesToSend = async (
  traces: TraceGroups,
  triggerId: string,
  projectId: string,
) => {
  const traceIds = traces.groups.flatMap((group) =>
    group.map((trace) => trace.trace_id),
  );

  const triggersSent = await triggerSentForMany(triggerId, traceIds, projectId);

  const tracesToSend = traces.groups.filter((group) => {
    return group.every((trace) => {
      return !triggersSent.some((sent) => sent.traceId === trace.trace_id);
    });
  });

  return tracesToSend;
};
