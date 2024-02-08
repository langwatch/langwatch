import {
  EVENTS_INDEX,
  SPAN_INDEX,
  TRACE_CHECKS_INDEX,
  TRACE_INDEX,
  esClient,
} from "../server/elasticsearch";

const migrateIndex = async (index: string) => {
  let results: any[] = [];

  let searchAfter: any;
  let response;
  do {
    response = await esClient.search({
      index,
      _source: {
        includes: ["timestamps"],
      },
      body: {
        query: {
          //@ts-ignore
          bool: {
            must_not: {
              exists: {
                field: "timestamps.updated_at",
              },
            },
          },
        },
        size: 5_000,
        sort: ["_doc"],
        ...(searchAfter ? { search_after: searchAfter } : {}),
      },
    });
    const records = response.hits.hits;
    results = results.concat(records);
    searchAfter = records[records.length - 1]?.sort;
    process.stdout.write(
      `\rFetched ${results.length} hits`
    );
  } while (response.hits.hits.length > 0);

  let bulkActions = [];
  for (let i = 0; i < results.length; i++) {
    const hit = results[i];
    if (!hit) continue;
    const trace = hit._source;
    if (!trace) continue;

    bulkActions.push({ update: { _index: index, _id: hit._id } });

    bulkActions.push({
      script: {
        source: `
          if (ctx._source.timestamps == null) {
            ctx._source.timestamps = new HashMap();
          }
          if (ctx._source.timestamps.inserted_at != null) {
            ctx._source.timestamps.updated_at = ctx._source.timestamps.inserted_at;
          } else {
            if (ctx._source.timestamps.started_at != null) {
              ctx._source.timestamps.inserted_at = ctx._source.timestamps.started_at;
              ctx._source.timestamps.updated_at = ctx._source.timestamps.started_at;
            }
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
  console.log("\nMigrating Traces");
  await migrateIndex(TRACE_INDEX);
  console.log("\nMigrating Spans");
  await migrateIndex(SPAN_INDEX);
  console.log("\nMigrating Trace Checks");
  await migrateIndex(TRACE_CHECKS_INDEX);
  console.log("\nMigrating Events");
  await migrateIndex(EVENTS_INDEX);
}
