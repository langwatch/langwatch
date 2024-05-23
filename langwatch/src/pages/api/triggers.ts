import { type NextApiRequest, type NextApiResponse } from "next";

import { TriggerAction } from "@prisma/client";
import { getAllForProject } from "~/server/api/routers/traces";
import { prisma } from "../../server/db";
import type { Prisma } from "@prisma/client";

import { sendTriggerEmail } from "~/server/mailer/triggerEmail";
import { getLatestUpdatedAt } from "./utils";

interface ActionParams {
  members?: string[] | null;
  dataset?: string | null;
}
interface Trigger {
  id: string;
  projectId: string;
  filters: Prisma.JsonValue;
  lastRunAt: number;
  action: string;
  actionParams: Prisma.JsonValue;
  name: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
  }

  const triggers = await prisma.trigger.findMany();

  const results = [];

  for (const trigger of triggers) {
    const traces = await getTracesForAlert(trigger);
    results.push(traces);
  }

  return res.status(200).json(results);
}

const getTracesForAlert = async (trigger: Trigger) => {
  const {
    id: alertId,
    projectId,
    filters,
    lastRunAt,
    action,
    actionParams,
    name,
  } = trigger;

  const input = {
    projectId,
    filters,
    updatedAt: lastRunAt,
  };

  // @ts-ignore
  const traces = await getAllForProject({}, input);

  if (traces.groups.length > 0) {
    const triggerData = traces.groups.flatMap((group) =>
      group.map((trace) => ({
        input: trace.input?.value,
        output: trace.output?.value ?? "",
        traceId: trace.trace_id,
      }))
    );

    const project = await prisma.project.findFirst({
      where: {
        id: input.projectId,
      },
    });

    let triggerInfo;
    let updatedAt = 0;

    if (action === TriggerAction.SEND_EMAIL) {
      triggerInfo = {
        triggerEmails: (actionParams as ActionParams)?.members ?? "",
        triggerData,
        triggerName: name,
        projectSlug: project!.slug,
      };

      updatedAt = getLatestUpdatedAt(traces);

      await sendTriggerEmail(triggerInfo);
      void updateAlert(alertId, updatedAt);
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

const updateAlert = async (alertId: string, updatedAt: number) => {
  await prisma.trigger.update({
    where: { id: alertId },
    data: { lastRunAt: updatedAt },
  });
};
