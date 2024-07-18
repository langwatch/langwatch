import { TriggerAction, type Project, type Trigger } from "@prisma/client";
import { type NextApiRequest, type NextApiResponse } from "next";
import { getAllForProject } from "~/server/api/routers/traces";
import { sendTriggerEmail } from "~/server/mailer/triggerEmail";
import { sendSlackWebhook } from "~/server/triggers/sendSlackWebhook";
import { prisma } from "../../server/db";

import { type ElasticSearchTrace } from "~/server/tracer/types";

interface TraceGroups {
  groups: ElasticSearchTrace[][];
}

interface ActionParams {
  members?: string[] | null;
  dataset?: string | null;
  slackWebhook?: string | null;
}

interface TriggerData {
  input: string;
  output: string;
  traceId: string;
  projectId: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).end();
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

  const traces = await getAllForProject(input);

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
      }))
    );

    const project = projects.find((project) => project.id === input.projectId);

    let triggerInfo;
    let updatedAt = 0;

    if (action === TriggerAction.SEND_EMAIL) {
      triggerInfo = {
        triggerEmails: (actionParams as ActionParams)?.members ?? [],
        triggerData,
        triggerName: name,
        projectSlug: project!.slug,
      };

      updatedAt = getLatestUpdatedAt(traces);

      await sendTriggerEmail(triggerInfo);
      if (project) {
        void updateAlert(triggerId, updatedAt, project.id);
      } else {
        throw new Error("Project not found for triggerId: " + triggerId);
      }
    } else if (action === TriggerAction.SEND_SLACK_MESSAGE) {
      triggerInfo = {
        triggerWebhook: (actionParams as ActionParams)?.slackWebhook ?? "",
        triggerData,
        triggerName: name,
        projectSlug: project!.slug,
      };

      updatedAt = getLatestUpdatedAt(traces);

      await sendSlackWebhook(triggerInfo);
      await addTriggersSent(triggerId, triggerData);
      if (project) {
        void updateAlert(triggerId, updatedAt, project.id);
      } else {
        throw new Error("Project not found for triggerId: " + triggerId);
      }
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
  groups: ElasticSearchTrace[][];
}

export const getLatestUpdatedAt = (traces: TraceGroups) => {
  const updatedTimes = traces.groups
    .flatMap((group: any) =>
      group.map((item: any) => item.timestamps.updated_at)
    )
    .sort((a: number, b: number) => b - a);

  return updatedTimes[0];
};
