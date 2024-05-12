import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import {
  SPAN_INDEX,
  TRACE_CHECKS_INDEX,
  TRACE_INDEX,
  esClient,
} from "../server/elasticsearch";
import type { ErrorCapture } from "../server/tracer/types";

const migrateIndex = async (index: string) => {
  let searchAfter: any;
  let response;
  let bulkActions = [];

  do {
    response = await esClient.search<{ error?: ErrorCapture }>({
      index,
      _source: {
        includes: ["error"],
      },
      body: {
        query: {
          bool: {
            must: [
              {
                bool: {
                  must_not: {
                    exists: {
                      field: "error.has_error",
                    },
                  } as QueryDslQueryContainer,
                },
              },
              {
                exists: {
                  field: "error",
                },
              },
            ],
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
          error: { ...hit._source!.error, has_error: true },
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
};

export default async function execute() {
  console.log("\nMigrating Trace Checks");
  await migrateIndex(TRACE_CHECKS_INDEX);
  console.log("\nMigrating Spans");
  await migrateIndex(SPAN_INDEX);
  console.log("\nMigrating Traces");
  await migrateIndex(TRACE_INDEX);
}
