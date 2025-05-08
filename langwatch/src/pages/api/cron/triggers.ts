import { TriggerAction, type Project, type Trigger } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { type NextApiRequest, type NextApiResponse } from "next";
import { getAllTracesForProject } from "~/server/api/routers/traces";
import { sendTriggerEmail } from "~/server/mailer/triggerEmail";
import { sendSlackWebhook } from "~/server/triggers/sendSlackWebhook";
import { prisma } from "../../../server/db";
import { createOrUpdateQueueItems } from "~/server/api/routers/annotation";
import { type Trace } from "~/server/tracer/types";
import { createManyDatasetRecords } from "~/server/api/routers/datasetRecord";
import type { DatasetRecordEntry } from "~/server/datasets/types";
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
  res: NextApiResponse
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
    const traces = await getTracesForAlert(trigger, projects);
    results.push(traces);
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
      group.map((trace) => trace.trace_id)
    );

    const triggersSent = await triggerSentForMany(
      triggerId,
      traceIds,
      input.projectId
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
      }))
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
        Sentry.captureException(error, {
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
        Sentry.captureException(error, {
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
        Sentry.captureException(error, {
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
            undefined
          );

          for (const entry of mappedEntries) {
            const sanitizedEntry = Object.fromEntries(
              Object.entries(entry).map(([key, value]) => [
                key,
                typeof value === "string"
                  ? value.replace(/\u0000/g, "")
                  : value,
              ])
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
        Sentry.captureException(error, {
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
  projectId: string
) => {
  await prisma.trigger.update({
    where: { id: triggerId, projectId },
    data: { lastRunAt: updatedAt },
  });
};

const addTriggersSent = async (
  triggerId: string,
  triggerData: TriggerData[]
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
  projectId: string
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
      group.map((item: any) => item.timestamps.updated_at)
    )
    .sort((a: number, b: number) => b - a);

  return updatedTimes[0];
};

const createQueueItems = async (
  triggerData: TriggerData[],
  annotators: { id: string; name: string }[],
  createdByUserId?: string
) => {
  await Promise.all(
    triggerData.map((data) =>
      createOrUpdateQueueItems({
        traceIds: [data.traceId],
        projectId: data.projectId,
        annotators: annotators.map((annotator) => annotator.id),
        userId: createdByUserId ?? "",
        prisma: prisma,
      })
    )
  );
};
