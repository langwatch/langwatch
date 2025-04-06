import { TRACE_INDEX, esClient, traceIndexId } from "../server/elasticsearch";
import { type Trace } from "../server/tracer/types";

export default async function execute(projectId: string = "project_sample_id") {
  const client = await esClient(undefined, projectId);
  const result = await client.search<Trace>({
    index: TRACE_INDEX.alias,
    body: {
      size: 10_000,
      _source: ["trace_id", "project_id"],
      query: {
        //@ts-ignore
        bool: {
          must: [
            {
              term: { project_id: projectId },
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
      {
        update: {
          _id: traceIndexId({
            traceId: trace.trace_id,
            projectId: trace.project_id,
          }),
        },
      },
      {
        doc: {
          metadata: { topics: null },
          timestamps: { updated_at: Date.now() },
        },
      },
    ]);

    process.stdout.write(`\r${i + 1}/${totalRecords} records to be updated`);
  }

  await client.bulk({
    index: TRACE_INDEX.alias,
    body,
    refresh: true,
  });
}
