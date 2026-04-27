import { type Project, type Trigger, TriggerAction } from "@prisma/client";
import { getProtectionsForProject } from "~/server/api/utils";
import { prisma } from "~/server/db";
import { TraceService } from "~/server/traces/trace.service";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";
import { handleAddToAnnotationQueue } from "./actions/addToAnnotationQueue";
import { handleAddToDataset } from "./actions/addToDataset";
import { handleSendEmail } from "./actions/sendEmail";
import { handleSendSlackMessage } from "./actions/sendSlackMessage";
import type { Trace } from "~/server/tracer/types";
import type { TraceGroups, TriggerData, TriggerResult } from "./types";
import { addTriggersSent, triggerSentForMany, updateAlert } from "./utils";

const logger = createLogger("langwatch:cron:triggers:trace-based");

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
    pageSize: 500,
    startDate: Date.now() - 1000 * 60 * 60 * 24,
    endDate: Date.now(),
  };

  const traceService = TraceService.create(prisma);
  const protections = await getProtectionsForProject(prisma, { projectId });

  // Dedup against already-sent traces page-by-page so we never hold the full
  // result set in memory. Cap examined groups at 1_000 (was 10_000) — alerts
  // don't need more examples than that and the heavy `Trace` payload pushes
  // Node past V8's old-space limit for projects with many active triggers.
  const MAX_EXAMINED_GROUPS = 1_000;
  const tracesToSend: TraceGroups["groups"] = [];
  let latestUpdatedAt: number | undefined;
  let examinedGroups = 0;
  let scrollId: string | undefined;

  do {
    const result = await traceService.getAllTracesForProject(
      input,
      protections,
      { scrollId },
    );
    scrollId = result.scrollId ?? undefined;

    if (result.groups.length > 0) {
      const pageTraceIds = result.groups.flatMap((group) =>
        group.map((trace) => trace.trace_id),
      );
      const sent = await triggerSentForMany(
        triggerId,
        pageTraceIds,
        input.projectId,
      );
      const sentIds = new Set(sent.map((s) => s.traceId));

      for (const group of result.groups) {
        examinedGroups += 1;
        const updatedAt = getLatestUpdatedAtForGroup(group);
        if (
          updatedAt !== undefined &&
          (latestUpdatedAt === undefined || updatedAt > latestUpdatedAt)
        ) {
          latestUpdatedAt = updatedAt;
        }
        if (group.every((trace) => !sentIds.has(trace.trace_id))) {
          tracesToSend.push(group);
        }
        if (examinedGroups >= MAX_EXAMINED_GROUPS) break;
      }
    }
  } while (scrollId && examinedGroups < MAX_EXAMINED_GROUPS);

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
    const updatedAt = latestUpdatedAt ?? Date.now();

    try {
      await updateAlert(triggerId, updatedAt, project.id);
    } catch (error) {
      logger.error(
        { triggerId, error },
        "failed to update alert for trigger",
      );
    }

    return {
      triggerId,
      updatedAt: updatedAt,
      status: "triggered",
      totalFound: triggerData.length,
    };
  }

  return {
    triggerId,
    updatedAt: input.updatedAt,
    status: "not_triggered",
  };
};

const getLatestUpdatedAtForGroup = (group: Trace[]): number | undefined => {
  let latest: number | undefined;
  for (const trace of group) {
    const ts = trace.timestamps?.updated_at;
    if (ts !== undefined && (latest === undefined || ts > latest)) {
      latest = ts;
    }
  }
  return latest;
};
