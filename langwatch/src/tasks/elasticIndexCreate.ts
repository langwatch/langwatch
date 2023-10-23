import { type MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import {
  EMBEDDING_DIMENSION,
  SPAN_INDEX,
  TRACE_INDEX,
  esClient,
} from "../server/elasticsearch";
import { type Trace, type ElasticSearchSpan } from "../server/tracer/types";

const traceMapping: Record<keyof Trace, MappingProperty> = {
  id: { type: "keyword" },
  project_id: { type: "keyword" },
  session_id: { type: "keyword" },
  user_id: { type: "keyword" },
  timestamps: {
    properties: {
      started_at: { type: "date" },
      inserted_at: { type: "date" },
    },
  },
  input: {
    properties: {
      value: { type: "text" },
      openai_embeddings: {
        index: true,
        type: "dense_vector",
        dims: EMBEDDING_DIMENSION,
        similarity: "cosine",
      },
    },
  },
  output: {
    properties: {
      value: { type: "text" },
      openai_embeddings: {
        index: true,
        type: "dense_vector",
        dims: EMBEDDING_DIMENSION,
        similarity: "cosine",
      },
    },
  },
  metrics: {
    properties: {
      first_token_ms: { type: "integer" },
      total_time_ms: { type: "integer" },
      prompt_tokens: { type: "integer" },
      completion_tokens: { type: "integer" },
      tokens_estimated: { type: "boolean" },
      total_cost: { type: "float" },
    },
  },
  error: {
    properties: {
      message: { type: "text" },
      stacktrace: { type: "text" },
    },
  },
};

const spanMapping: Record<keyof ElasticSearchSpan, MappingProperty> = {
  project_id: { type: "keyword" },
  type: { type: "keyword" },
  name: { type: "text" },
  id: { type: "keyword" },
  parent_id: { type: "keyword" },
  trace_id: { type: "keyword" },
  input: {
    properties: {
      type: {
        type: "keyword",
      },
      value: { type: "text" },
    },
  },
  outputs: {
    type: "nested",
    properties: {
      type: {
        type: "keyword",
      },
      value: { type: "text" },
    },
  },
  error: {
    properties: {
      message: { type: "text" },
      stacktrace: { type: "text" },
    },
  },
  timestamps: {
    properties: {
      started_at: { type: "date" },
      first_token_at: { type: "date" },
      finished_at: { type: "date" },
    },
  },
  vendor: { type: "keyword" },
  model: { type: "keyword" },
  raw_response: { type: "text" },
  params: {
    properties: {
      temperature: { type: "float" },
      stream: { type: "boolean" },
      functions: { type: "nested" },
    },
  },
  metrics: {
    properties: {
      prompt_tokens: { type: "integer" },
      completion_tokens: { type: "integer" },
      tokens_estimated: { type: "boolean" },
    },
  },
};

export const createSpanIndex = async () => {
  const spanExists = await esClient.indices.exists({ index: SPAN_INDEX });
  if (!spanExists) {
    await esClient.indices.create({
      index: SPAN_INDEX,
      mappings: { properties: spanMapping },
    });
  }
  await esClient.indices.putMapping({
    index: SPAN_INDEX,
    properties: spanMapping,
  });

  const traceExists = await esClient.indices.exists({ index: TRACE_INDEX });
  if (!traceExists) {
    await esClient.indices.create({
      index: TRACE_INDEX,
      mappings: { properties: traceMapping },
    });
  }
  await esClient.indices.putMapping({
    index: TRACE_INDEX,
    properties: traceMapping,
  });
};

export default async function execute() {
  await createSpanIndex();
}
