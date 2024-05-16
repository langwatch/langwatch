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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
  }
  // const input = {
  //   projectId: "project_z-CcZUgvtagE70FuegKFg",
  //   startDate: 1713268800000,
  //   endDate: 1715774400000,
  //   filters: {
  //     "trace_checks.passed": { "check_b8deNyrYL53-u81gyLrFG": ["1"] },
  //   },
  //   groupBy: "input",
  // };

  const test = {
    projectId: "KAXYxPR8MUgTcP8CF193y",
    startDate: 1713351600000,
    endDate: 1715857200000,
    filters: { "trace_checks.passed": { check_wEVmNQKttsYpWhZYPz1Sa: ["0"] } },
    pageOffset: 0,
    pageSize: 25,
    groupBy: "none",
  };

  const input = {
    projectId: "KAXYxPR8MUgTcP8CF193y",
    filters: { "trace_checks.passed": { check_wEVmNQKttsYpWhZYPz1Sa: ["0"] } },
    updatedAt: 1713882821927,
  };

  const traces = await getAllForProject({}, input);

  let updatedTimes = traces.groups
    .flatMap((group) => group.map((item) => item.timestamps.updated_at))
    .sort((a, b) => b - a);

  return res.status(200).json({ hello: traces });
}
