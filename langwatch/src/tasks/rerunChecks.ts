import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import {
  // TRACE_CHECKS_INDEX,
  esClient,
  TRACE_INDEX,
} from "../server/elasticsearch";
import { type ElasticSearchEvaluation } from "../server/tracer/types";
// import {
//   scheduleTraceCheck,
//   traceChecksQueue,
// } from "../server/background/queues/traceChecksQueue";
// import { prisma } from "../server/db";
// import type { EvaluatorTypes } from "../trace_checks/evaluators.generated";

// TODO: update this task to use single traces index now

export default async function execute(evaluatorId: string, projectId: string) {
  const client = await esClient({ projectId });
  const traceChecks = await client.search<ElasticSearchEvaluation>({
    index: TRACE_INDEX.alias,
    size: 100,
    body: {
      query: {
        bool: {
          must: [
            {
              bool: {
                must_not: [
                  {
                    term: {
                      "evaluations.status": "processed",
                    },
                  },
                ],
              },
            },
            {
              term: {
                "evaluations.evaluator_id": evaluatorId,
              },
            },
            {
              range: {
                "timestamps.inserted_at": {
                  gt: Date.now() - 1000 * 60 * 60 * 24 * 2, // 2 days
                },
              },
            },
          ] as QueryDslQueryContainer[],
        } as QueryDslBoolQuery,
      },
    },
  });

  //eslint-disable-next-line
  const hits = traceChecks.hits.hits;

  throw "This task is currently broken, fix it when needed";
  // for (const hit of hits) {
  //   const traceCheck = hit._source;
  //   if (!traceCheck) continue;

  //   const jobId = traceCheckIndexId({
  //     traceId: traceCheck.trace_id,
  //     checkId,
  //     projectId: traceCheck.project_id,
  //   });
  //   const currentJob = await traceChecksQueue.getJob(jobId);
  //   if (currentJob) {
  //     const state = await currentJob.getState();
  //     if (state == "completed" || state == "failed") {
  //       console.log("Retrying job", jobId);
  //       await currentJob.retry(state);
  //     }
  //   } else {
  //     const check = await prisma.monitor.findFirst({
  //       where: {
  //         id: checkId,
  //         projectId: traceCheck.project_id,
  //       },
  //     });
  //     if (!check) {
  //       throw "Check not found";
  //     }

  //     await scheduleTraceCheck({
  //       check: {
  //         ...check,
  //         type: check.checkType as EvaluatorTypes,
  //       },
  //       trace: {
  //         trace_id: traceCheck.trace_id,
  //         project_id: traceCheck.project_id,
  //       },
  //     });
  //   }
  // }
}
