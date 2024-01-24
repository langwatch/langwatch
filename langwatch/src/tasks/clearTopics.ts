import { TRACE_INDEX, esClient } from "../server/elasticsearch";
import { type Trace } from "../server/tracer/types";

export default async function execute() {
  const result = await esClient.search<Trace>({
    index: TRACE_INDEX,
    body: {
      size: 10_000,
      _source: ["id"],
      query: {
        //@ts-ignore
        bool: {
          must: [
            {
              term: { project_id: "project_sample_id" },
            },
            {
              exists: {
                field: "topics",
              },
            },
          ],
        },
      },
    },
  });

  const totalRecords = result.hits.hits.length;

  let body: any[] = [];
  for (let i = 0; i < totalRecords; i++) {
    const trace = result.hits.hits[i]?._source;
    if (!trace) continue;

    body = body.concat([
      { update: { _id: trace.id } },
      { doc: { topics: null } },
    ]);

    process.stdout.write(`\r${i + 1}/${totalRecords} records to be updated`);
  }

  await esClient.bulk({
    index: TRACE_INDEX,
    body,
    refresh: true,
  });
}
