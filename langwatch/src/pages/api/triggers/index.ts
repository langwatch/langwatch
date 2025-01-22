import {
  TriggerAction,
  type AlertType,
  type Project,
  type Trigger,
} from "@prisma/client";
import { type NextApiRequest, type NextApiResponse } from "next";
import { getAllTracesForProject } from "~/server/api/routers/traces";
import { sendTriggerEmail } from "~/server/mailer/triggerEmail";
import { sendSlackWebhook } from "~/server/triggers/sendSlackWebhook";
import { prisma } from "../../../server/db";

import { type Trace } from "~/server/tracer/types";

import {
  mapTraceToDatasetEntry,
  type TRACE_EXPANSIONS,
  type Mapping,
} from "~/components/datasets/DatasetMapping";

import { createManyDatasetRecords } from "~/server/api/routers/datasetRecord";

import type { DatasetRecordEntry } from "~/server/datasets/types";

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

  let cronApiKey = req.headers["authorization"];
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

  const traces = await getAllTracesForProject({ input });

  const getTracesToSend = async (traces: TraceGroups, triggerId: string) => {
    const tracesToSend = [];

    for (const group of traces.groups) {
      const results = await Promise.all(
        group.map((trace) =>
          hasTriggerSent(triggerId, trace.trace_id, input.projectId)
        )
      );
      if (results.some((sent) => !sent)) {
        tracesToSend.push(group);
      }
    }

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
      triggerInfo = {
        triggerEmails: (actionParams as unknown as ActionParams)?.members ?? [],
        triggerData,
        triggerName: name,
        projectSlug: project!.slug,
        triggerType: trigger.alertType as AlertType,
        triggerMessage: trigger.message as string,
      };

      updatedAt = getLatestUpdatedAt(traces);

      await sendTriggerEmail(triggerInfo);
      await addTriggersSent(triggerId, triggerData);
      if (project) {
        void updateAlert(triggerId, updatedAt, project.id);
      } else {
        throw new Error("Project not found for triggerId: " + triggerId);
      }
    } else if (action === TriggerAction.SEND_SLACK_MESSAGE) {
      triggerInfo = {
        triggerWebhook:
          (actionParams as unknown as ActionParams)?.slackWebhook ?? "",
        triggerData,
        triggerName: name,
        projectSlug: project!.slug,
        triggerType: trigger.alertType as AlertType,
        triggerMessage: trigger.message as string,
      };

      updatedAt = getLatestUpdatedAt(traces);

      await sendSlackWebhook(triggerInfo);
      await addTriggersSent(triggerId, triggerData);
      if (project) {
        void updateAlert(triggerId, updatedAt, project.id);
      } else {
        throw new Error("Project not found for triggerId: " + triggerId);
      }
    } else if (action === TriggerAction.ADD_TO_DATASET) {
      const trigger = await prisma.trigger.findUnique({
        where: { id: triggerId, projectId: input.projectId },
      });

      const { datasetId, datasetMapping } =
        trigger?.actionParams as unknown as ActionParams;

      const rowsToAdd = triggerData.map((trace) => trace.fullTrace);
      const now = Date.now();

      const { mapping, expansions } = datasetMapping;
      let index = 0;
      const entries: DatasetRecordEntry[] = [];

      for (const trace of rowsToAdd) {
        const mappedEntries = mapTraceToDatasetEntry(
          trace,
          mapping as Mapping,
          expansions,
          undefined
        );

        for (const entry of mappedEntries) {
          const sanitizedEntry = Object.fromEntries(
            Object.entries(entry).map(([key, value]) => [
              key,
              typeof value === "string" ? value.replace(/\u0000/g, "") : value,
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

      const createManyDatasetRecordsResult = await createManyDatasetRecords({
        datasetId: datasetId,
        projectId: input.projectId,
        datasetRecords: entries,
      });

      triggerInfo = {
        triggerData,
        triggerName: name,
        projectSlug: project!.slug,
      };

      await addTriggersSent(triggerId, triggerData);
    }

    return {
      triggerId,
      updatedAt: updatedAt,
      status: "triggered",
      totalFound: tracesToSend.length,
      triggerInfo,
      traces: tracesToSend,
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

const hasTriggerSent = async (
  triggerId: string,
  traceId: string,
  projectId: string
) => {
  const triggerSent = await prisma.triggerSent.findUnique({
    where: { triggerId_traceId: { triggerId, traceId }, projectId },
  });
  return triggerSent !== null;
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
