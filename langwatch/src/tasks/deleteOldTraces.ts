import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import { TRACE_INDEX, esClient } from "../server/elasticsearch";

const deleteOldTraces = async (projectId: string, lt: number) => {
  let searchAfter: any;
  let response;
  let bulkActions = [];

  do {
    response = await esClient.search({
      index: TRACE_INDEX.alias,
      _source: {
        includes: ["trace_id"],
      },
      body: {
        query: {
          bool: {
            must: [
              {
                term: { project_id: projectId },
              },
              {
                range: {
                  "timestamps.inserted_at": {
                    lt,
                  },
                },
              },
            ] as QueryDslQueryContainer[],
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

    process.stdout.write("\n");

    for (let i = 0; i < results.length; i++) {
      const hit = results[i];
      if (!hit) continue;
      const item = hit._source;
      if (!item) continue;

      bulkActions.push({
        delete: {
          _index: TRACE_INDEX.alias,
          _id: hit._id,
        },
      });
      process.stdout.write(`\r${i + 1}/${results.length} being deleted`);

      if (bulkActions.length >= 400) {
        try {
          await esClient.bulk({ body: bulkActions });
          bulkActions = [];
        } catch (error) {
          console.error("Error in bulk action:", error);
        }
      }
    }

    if (bulkActions.length > 0) {
      try {
        await esClient.bulk({ body: bulkActions });
      } catch (error) {
        console.error("Error in bulk action:", error);
      }
    }
  } while (response.hits.hits.length > 0);
};

export default async function execute(projectId: string) {
  console.log("\nDeleting old Traces");
  await deleteOldTraces(projectId, new Date(2024, 2, 11).getTime());
}
