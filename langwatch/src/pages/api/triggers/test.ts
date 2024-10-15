import {
  TriggerAction,
  type AlertType,
  type Project,
  type Trigger,
} from "@prisma/client";
import { type NextApiRequest, type NextApiResponse } from "next";
import { getTracesWithSpans } from "~/server/api/routers/traces";
import { prisma } from "~/server/db";
import { sendTriggerEmail } from "~/server/mailer/triggerEmail";
import { sendSlackWebhook } from "~/server/triggers/sendSlackWebhook";

import { type Trace } from "~/server/tracer/types";

interface ActionParams {
  members?: string[] | null;
  dataset?: string | null;
  slackWebhook?: string | null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const traceId = req.body.traceId as string;
  const projectId = req.body.projectId as string;
  const triggerId = req.body.triggerId as string;

  const trace = await getTracesWithSpans(projectId, [traceId]);
  if (!trace) {
    return res.status(404).json({ error: "Trace not found" });
  }

  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
    },
  });

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const trigger = await prisma.trigger.findUnique({
    where: {
      id: triggerId,
      projectId,
    },
  });

  if (!trigger) {
    return res.status(404).json({ error: "Trigger not found" });
  }

  const sendTrigger = async (
    trigger: Trigger,
    project: Project,
    trace: Trace
  ) => {
    const { projectId, action, actionParams, name } = trigger;

    const triggerData = [
      {
        input: trace.input?.value ?? "",
        output: trace.output?.value ?? "",
        traceId: trace.trace_id,
        projectId: projectId,
      },
    ];

    let triggerInfo;

    if (action === TriggerAction.SEND_EMAIL) {
      triggerInfo = {
        triggerEmails: (actionParams as ActionParams)?.members ?? [],
        triggerData,
        triggerName: name,
        projectSlug: project.slug,
        triggerType: trigger.alertType as AlertType,
        triggerMessage: trigger.message as string,
      };

      await sendTriggerEmail(triggerInfo);
    } else if (action === TriggerAction.SEND_SLACK_MESSAGE) {
      triggerInfo = {
        triggerWebhook: (actionParams as ActionParams)?.slackWebhook ?? "",
        triggerData,
        triggerName: name,
        projectSlug: project.slug,
        triggerType: trigger.alertType as AlertType,
        triggerMessage: trigger.message as string,
      };

      await sendSlackWebhook(triggerInfo);
    }

    return res.status(200).json({ trace, project, trigger, triggerInfo });
  };

  if (trace[0]) {
    await sendTrigger(trigger, project, trace[0]);
  } else {
    throw new Error("No valid trace found");
  }
}
