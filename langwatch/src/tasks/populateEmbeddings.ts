import { getSearchEmbeddings } from "~/pages/api/collector/trace";
import { TRACE_INDEX, esClient, traceIndexId } from "../server/elasticsearch";
import { getOpenAIEmbeddings } from "../server/embeddings";
import { type Trace } from "../server/tracer/types";

export default async function execute() {
  const result = await esClient.search<Trace>({
    index: TRACE_INDEX,
    body: {
      size: 10_000,
      query: {
        //@ts-ignore
        bool: {
          must_not: {
            exists: {
              field: "search_embeddings.openai_embeddings",
            },
          },
        },
      },
    },
  });

  const totalRecords = result.hits.hits.length;

  for (let i = 0; i < totalRecords; i++) {
    const trace = result.hits.hits[i]?._source;
    if (!trace) continue;

    const [inputEmbeddings, outputEmbeddings, searchEmbeddings] =
      await Promise.all([
        trace.input.openai_embeddings
          ? undefined
          : trace.input.value
          ? getOpenAIEmbeddings(trace.input.value)
          : undefined,
        trace.output?.openai_embeddings
          ? undefined
          : trace.output?.value
          ? getOpenAIEmbeddings(trace.output.value)
          : undefined,
        getSearchEmbeddings(trace.input, trace.output, trace.error ?? null),
      ]);

    await esClient.update({
      index: TRACE_INDEX,
      id: traceIndexId({
        traceId: trace.trace_id,
        projectId: trace.project_id,
      }),
      body: {
        doc: {
          ...(inputEmbeddings
            ? { "input.openai_embeddings": inputEmbeddings }
            : {}),
          ...(outputEmbeddings
            ? { "output.openai_embeddings": outputEmbeddings }
            : {}),
          "search_embeddings.openai_embeddings": searchEmbeddings,
          "timestamp.updated_at": Date.now(),
        },
      },
    });

    process.stdout.write(
      `\r${i + 1}/${totalRecords} record embeddings updated`
    );
  }
}
