import { type NextApiRequest, type NextApiResponse } from "next";

import { type Trigger, TriggerAction, type Project } from "@prisma/client";
import { getAllForProject } from "~/server/api/routers/traces";
import { prisma } from "../../server/db";

import { sendTriggerEmail } from "~/server/mailer/triggerEmail";
import { getLatestUpdatedAt } from "./utils";

interface ActionParams {
  members?: string[] | null;
  dataset?: string | null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
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
    id: alertId,
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

  if (traces.groups.length > 0) {
    const triggerData = traces.groups.flatMap((group) =>
      group.map((trace) => ({
        input: trace.input?.value,
        output: trace.output?.value ?? "",
        traceId: trace.trace_id,
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
        void updateAlert(alertId, updatedAt, project.id);
      } else {
        console.error("Project not found for alertId:", alertId);
      }
    }

    return {
      alertId,
      updatedAt: updatedAt,
      status: "triggered",
      totalFound: traces.groups.length,
      triggerInfo,
      traces: traces.groups,
    };
  }

  return {
    alertId,
    updatedAt: input.updatedAt,
    status: "not_triggered",
    traces: "null",
  };
};

const updateAlert = async (
  alertId: string,
  updatedAt: number,
  projectId: string
) => {
  await prisma.trigger.update({
    where: { id: alertId, projectId },
    data: { lastRunAt: updatedAt },
  });
};
