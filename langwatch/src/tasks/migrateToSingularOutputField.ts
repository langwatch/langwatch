import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import { SPAN_INDEX, esClient, traceIndexId } from "../server/elasticsearch";

const migrateIndex = async (index: string) => {
  let results: any[] = [];

  let searchAfter: any;
  let response;
  do {
    response = await esClient.search({
      index,
      _source: {
        includes: ["project_id", "outputs"],
      },
      body: {
        query: {
          bool: {
            must: [
              {
                nested: {
                  path: "outputs",
                  query: {
                    exists: {
                      field: "outputs.value",
                    },
                  },
                },
              },
            ],
            must_not: {
              exists: {
                field: "output",
              },
            } as QueryDslQueryContainer,
          } as QueryDslBoolQuery,
        },
        size: 5_000,
        sort: ["_doc"],
        ...(searchAfter ? { search_after: searchAfter } : {}),
      },
    });
    const records = response.hits.hits;
    results = results.concat(records);
    searchAfter = records[records.length - 1]?.sort;
    process.stdout.write(`\rFetched ${results.length} hits`);
  } while (response.hits.hits.length > 0);

  let bulkActions = [];
  for (let i = 0; i < results.length; i++) {
    const hit = results[i];
    if (!hit) continue;
    const item = hit._source;
    if (!item) continue;

    bulkActions.push({
      update: {
        _index: index,
        _id: hit._id,
        ...(index === SPAN_INDEX && item.trace_id && item.project_id
          ? {
              routing: traceIndexId({
                traceId: item.trace_id,
                projectId: item.project_id,
              }),
            }
          : {}),
      },
    });

    bulkActions.push({
      script: {
        source: `
          if (ctx._source.output == null) {
            if (ctx._source.outputs.length > 0) {
              ctx._source.output = ctx._source.outputs[0];
            } else {
              ctx._source.output = null;
            }
            ctx._source.remove('outputs');
          }
        `,
        lang: "painless",
      },
    });

    process.stdout.write(`\r${i + 1}/${results.length} records to be updated`);

    if (bulkActions.length >= 1000) {
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
};

export default async function execute() {
  console.log("\nMigrating Spans");
  await migrateIndex(SPAN_INDEX);
}
