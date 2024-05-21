import { type NextApiRequest, type NextApiResponse } from "next";
import {
  SPAN_INDEX,
  TRACES_PIVOT_INDEX,
  TRACE_CHECKS_INDEX,
  TRACE_INDEX,
  esClient,
  traceIndexId,
} from "~/server/elasticsearch";

import type { TracesPivot } from "~/server/analytics/types";
import type { Sort } from "@elastic/elasticsearch/lib/api/types";

import { generateTracesPivotQueryConditions } from "~/server/api/routers/analytics/common";

import { getAllForProject } from "~/server/api/routers/traces";
import { prisma } from "../../server/db";
import { sendTriggerEmail } from "~/server/mailer/triggerEmail";

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
    const { id, projectId, filters, lastRunAt, action, actionParams } = trigger;
    const input = {
      projectId,
      filters,
      updatedAt: lastRunAt,
    };

    const traces = await getTracesForAlert(input, id);
    results.push(traces);
  }

  return res.status(200).json(results);
}

const getTracesForAlert = async (input, alertId) => {
  console.log("alertId", alertId);
  const traces = await getAllForProject({}, input);

  if (traces.groups.length > 0) {
    console.log("traces.groups", traces.groups);

    const emailData = traces.groups.flatMap((group) =>
      group.map((trace) => ({
        input: trace.input?.value,
        output: trace.output?.value,
        traceId: trace.trace_id,
      }))
    );

    const updatedTimes = traces.groups
      .flatMap((group) => group.map((item) => item.timestamps.updated_at))
      .sort((a, b) => b - a);

    console.log(updatedTimes);

    void sendTriggerEmail("richard@langwatch.ai", emailData, "test name");

    // void updateAlert(alertId, updatedTimes[0]);

    return {
      alertId,
      updatedAt: updatedTimes[0],
      status: "triggered",
      totalFound: traces.groups.length,
      emailData,
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
