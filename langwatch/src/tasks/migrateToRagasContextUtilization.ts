import type { QueryDslBoolQuery, QueryDslQueryContainer } from "@elastic/elasticsearch/lib/api/types";
import { prisma } from "../server/db";
import { TRACE_CHECKS_INDEX, esClient } from "../server/elasticsearch";

const migrateIndex = async (index: string) => {
  let searchAfter: any;
  let response;
  let bulkActions = [];

  do {
    response = await esClient.search({
      index,
      _source: {
        includes: ["check_type"],
      },
      body: {
        query: {
          bool: {
            must: {
              term: {
                check_type: "ragas_context_precision",
              },
            } as QueryDslQueryContainer,
          } as QueryDslBoolQuery,
        },
        size: 500,
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
      if (!hit) continue;

      bulkActions.push({
        update: {
          _index: index,
          _id: hit._id,
        },
      });
      bulkActions.push({
        doc: {
          check_type: "ragas_context_utilization",
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

  await prisma.check.updateMany({
    where: {
      checkType: "ragas_context_precision",
      // projectId: input.projectId,
    },
    data: {
      checkType: "ragas_context_utilization",
    },
  });
};

export default async function execute() {
  console.log("\nMigrating Trace Checks");
  await migrateIndex(TRACE_CHECKS_INDEX);
}
