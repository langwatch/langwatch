import { type MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import { SPAN_INDEX, esClient } from "../server/elasticsearch";
import { type ElasticSearchSpan } from "../server/tracer/types";

const spanMapping: Record<keyof ElasticSearchSpan, MappingProperty> = {
  project_id: { type: "keyword" },
  type: { type: "keyword" },
  name: { type: "text" },
  span_id: { type: "keyword" },
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
    },
  },
};

export const createSpanIndex = async () => {
  const exists = await esClient.indices.exists({ index: SPAN_INDEX });
  if (!exists) {
    await esClient.indices.create({
      index: SPAN_INDEX,
      mappings: { properties: spanMapping },
    });
  }
  await esClient.indices.putMapping({
    index: SPAN_INDEX,
    properties: spanMapping,
  });
};

export default async function execute() {
  await createSpanIndex();
}
