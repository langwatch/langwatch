import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import { prisma } from "../server/db";
import { TRACE_CHECKS_INDEX, esClient } from "../server/elasticsearch";
import type { TraceCheck } from "../server/tracer/types";
import type { EvaluatorTypes } from "../trace_checks/evaluators.generated";

const migrateIndex = async (index: string) => {
  let searchAfter: any;
  let response;
  let bulkActions = [];

  const checkTypeMap: Record<string, EvaluatorTypes> = {
    "custom/basic": "langevals/basic",
    "custom/llm_boolean": "langevals/llm_boolean",
    "custom/llm_score": "langevals/llm_score",
    "custom/similarity": "langevals/similarity",
  };

  do {
    response = await esClient.search<TraceCheck>({
      index,
      _source: {
        includes: ["check_id", "check_type", "status", "value"],
      },
      body: {
        size: 500,
        query: {
          bool: {
            must: [
              {
                terms: {
                  check_type: Object.keys(checkTypeMap),
                },
              },
            ] as QueryDslBoolQuery["must"],
          } as QueryDslBoolQuery,
        },
        sort: ["_doc"],
        ...(searchAfter ? { search_after: searchAfter } : {}),
      },
    });
    const results = response.hits.hits;
    searchAfter = results[results.length - 1]?.sort;
    process.stdout.write(
      `\nFetched ${results.length} more hits from ${
        (response as any).hits.total.value
      } total\n`
    );

    for (let i = 0; i < results.length; i++) {
      const hit = results[i];
      if (!hit?._source) continue;

      const newCheckType =
        checkTypeMap[hit._source?.check_type ?? ""] ?? "unknown";

      bulkActions.push({
        update: {
          _index: index,
          _id: hit._id,
        },
      });
      bulkActions.push({
        doc: {
          check_type: newCheckType,
          timestamps: {
            updated_at: Date.now(),
          },
        },
      });

      process.stdout.write(`\r${i + 1}/${results.length} being updated`);

      if (bulkActions.length >= 400) {
        try {
          await esClient.bulk({ body: bulkActions });
          bulkActions = [];
        } catch (error) {
          console.error("Error in bulk update:", error);
        }
      }
    }

    if (bulkActions.length > 0) {
      try {
        await esClient.bulk({ body: bulkActions });
      } catch (error) {
        console.error("Error in bulk update:", error);
      }
    }
  } while (response.hits.hits.length > 0);

  for (const [checkType, evaluatorType] of Object.entries(checkTypeMap)) {
    await prisma.check.updateMany({
      where: {
        checkType: checkType,
      },
      data: {
        checkType: evaluatorType,
      },
    });
  }
};

export default async function execute() {
  console.log("\nMigrating Trace Checks");
  await migrateIndex(TRACE_CHECKS_INDEX);
}
