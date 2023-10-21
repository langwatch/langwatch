import { Client } from "@elastic/elasticsearch";
import { env } from "../env.mjs";

export const TRACE_INDEX = "search-traces";

export const SPAN_INDEX = "search-spans";

export const EMBEDDING_DIMENSION = 1536;

export const esClient = new Client({
  node: env.ELASTICSEARCH_NODE_URL,
  auth: {
    apiKey: env.ELASTICSEARCH_API_KEY,
  },
});
