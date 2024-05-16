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
  const input = {
    projectId: "project_z-CcZUgvtagE70FuegKFg",
    startDate: 1713268800000,
    endDate: 1715774400000,
    filters: {
      "trace_checks.passed": { "check_b8deNyrYL53-u81gyLrFG": ["1"] },
    },
    groupBy: "input",
  };


  //const traces = await getAllForProject({},input);

  const { pivotIndexConditions } = generateTracesPivotQueryConditions(input);

  const pageSize = input.pageSize ? input.pageSize : 25;
  const pageOffset = input.pageOffset ? input.pageOffset : 0;

  const pivotIndexResults = await esClient.search<TracesPivot>({
    index: TRACES_PIVOT_INDEX,
    body: {
      query: pivotIndexConditions,
      _source: ["trace.trace_id"],
      from: input.query ? 0 : pageOffset,
      size: input.query ? 10_000 : pageSize,
      ...(input.sortBy
        ? input.sortBy.startsWith("random.")
          ? {
              sort: {
                _script: {
                  type: "number",
                  script: {
                    source: "Math.random()",
                  },
                  order: input.sortDirection ?? "desc",
                },
              } as Sort,
            }
          : input.sortBy.startsWith("trace_checks.")
          ? {
              sort: {
                "trace_checks.score": {
                  order: input.sortDirection ?? "desc",
                  nested: {
                    path: "trace_checks",
                    filter: {
                      term: {
                        "trace_checks.check_id": input.sortBy.split(".")[1],
                      },
                    },
                  },
                },
              } as Sort,
            }
          : {
              sort: {
                [input.sortBy]: {
                  order: input.sortDirection ?? "desc",
                },
              } as Sort,
            }
        : {
            sort: {
              "trace.timestamps.started_at": {
                order: "desc",
              },
            } as Sort,
          }),
    },
  });

<<<<<<< Updated upstream
  return res.status(200).json({ hello: "world" });
=======
  return res.status(200).json({ hello: pivotIndexResults });
>>>>>>> Stashed changes
}
