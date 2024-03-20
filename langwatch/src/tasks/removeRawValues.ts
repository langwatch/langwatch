import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import {
  SPAN_INDEX,
  TRACE_CHECKS_INDEX,
  esClient,
} from "../server/elasticsearch";

const migrateIndex = async (index: string, fieldToDelete: string) => {
  let searchAfter: any;
  let response;
  let bulkActions = [];

  do {
    response = await esClient.search<any>({
      index,
      _source: {
        includes: [fieldToDelete],
      },
      body: {
        size: 500,
        query: {
          bool: {
            must: {
              exists: {
                field: fieldToDelete,
              },
            },
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

      bulkActions.push({ update: { _index: index, _id: hit._id } });

      bulkActions.push({
        script: {
          source: `
            if (ctx._source.containsKey('${fieldToDelete}')) {
              ctx._source.remove('${fieldToDelete}');
            }
          `,
          lang: "painless",
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
  console.log("\nRemoving raw_response from spans\n");
  await migrateIndex(SPAN_INDEX, "raw_response");
  console.log("\nRemoving raw_result from trace checks\n");
  await migrateIndex(TRACE_CHECKS_INDEX, "raw_result");
}
