import {
  TRACE_CHECKS_INDEX,
  esClient,
} from "../server/elasticsearch";
import { type TraceCheck } from "../server/tracer/types";
import type { CheckTypes } from "../trace_checks/types";

export default async function execute() {
  const result = await esClient.search<TraceCheck>({
    index: TRACE_CHECKS_INDEX,
    body: {
      size: 10_000,
      _source: ["id", "value", "check_type", "raw_result"],
      query: {
        //@ts-ignore
        bool: {
          must: [
            {
              term: {
                status: {
                  value: "scheduled",
                },
              },
            },
          ],
        },
      },
    },
  });

  const totalRecords = result.hits.hits.length;

  const quickLogic = (
    checkType: CheckTypes,
    raw_result: any,
    value: number | undefined
  ): TraceCheck["status"] => {
    if (!value) {
      return "failed";
    }

    if (checkType == "pii_check") {
      return value > 0 ? "failed" : "succeeded";
    }
    if (checkType == "jailbreak_check") {
      return value > 0 ? "failed" : "succeeded";
    }
    if (checkType == "ragas_answer_relevancy") {
      return value > 0.5 ? "succeeded" : "failed";
    }
    if (checkType == "ragas_context_precision") {
      return value > 0.3 ? "succeeded" : "failed";
    }
    if (checkType == "ragas_faithfulness") {
      return value > 0.3 ? "succeeded" : "failed";
    }
    if (checkType == "toxicity_check") {
      return value > 0 ? "failed" : "succeeded";
    }
    if (checkType == "custom") {
      return raw_result?.failedRules &&
        Array.isArray(raw_result.failedRules) &&
        raw_result.failedRules.length > 0
        ? "failed"
        : "succeeded";
    }
    return "failed";
  };

  let body: any[] = [];
  for (let i = 0; i < totalRecords; i++) {
    const traceCheck = result.hits.hits[i]?._source;
    if (
      !traceCheck ||
      !traceCheck.raw_result ||
      Object.keys(traceCheck.raw_result).length == 0
    )
      continue;

    body = body.concat([
      { update: { _id: traceCheck.id } },
      {
        doc: {
          status: quickLogic(
            traceCheck.check_type as CheckTypes,
            traceCheck.raw_result,
            traceCheck.value
          ),
        },
      },
    ]);

    process.stdout.write(`\r${i + 1}/${totalRecords} records updated`);
  }

  if (body.length > 0) {
    await esClient.bulk({
      index: TRACE_CHECKS_INDEX,
      body,
      refresh: true,
    });
  }
}
