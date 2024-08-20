import { Client as ElasticClient } from "@elastic/elasticsearch";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";

import { env } from "../env.mjs";

export type IndexSpec = {
  alias: string;
  base: string;
};

export const MIGRATION_INDEX = "search-elastic-migrations";

export const TRACE_INDEX: IndexSpec = {
  base: "search-traces",
  alias: "search-traces-alias",
};

export const DSPY_STEPS_INDEX: IndexSpec = {
  base: "search-dspy-steps",
  alias: "search-dspy-steps-alias",
};

export const OPENAI_EMBEDDING_DIMENSION = 1536;

export const esClient = process.env.IS_OPENSEARCH
  ? (new OpenSearchClient({
      node: env.ELASTICSEARCH_NODE_URL,
    }) as unknown as ElasticClient)
  : new ElasticClient({
      node: env.ELASTICSEARCH_NODE_URL,
      ...(env.ELASTICSEARCH_API_KEY
        ? {
            auth: {
              apiKey: env.ELASTICSEARCH_API_KEY,
            },
          }
        : {}),
    });

export const FLATENNED_TYPE = process.env.IS_OPENSEARCH
  ? "flat_object"
  : "flattened";

// @ts-ignore
if (process.env.IS_OPENSEARCH) {
  const originalExists = esClient.indices.exists;
  // @ts-ignore
  esClient.indices.exists = async (...params) => {
    // @ts-ignore
    return (await originalExists.bind(esClient.indices)(...params)).body;
  };

  const originalSearch = esClient.search;
  // @ts-ignore
  esClient.search = async (...params) => {
    // @ts-ignore
    return (await originalSearch.bind(esClient)(...params)).body;
  };

  const originalCatIndices = esClient.cat.indices;
  // @ts-ignore
  esClient.cat.indices = async (...params) => {
    // @ts-ignore
    return (await originalCatIndices.bind(esClient.cat)(...params)).body;
  };

  const originalIndicesCreate = esClient.indices.create;
  // @ts-ignore
  esClient.indices.create = async (params: any) => {
    let params_ = { ...params };
    if (params_.settings) {
      if (!params_.body) {
        params_.body = {};
      }
      params_.body.settings = params_.settings;
      delete params_.settings;
    }
    if (params_.mappings) {
      if (!params_.body) {
        params_.body = {};
      }
      params_.body.mappings = params_.mappings;
      delete params_.mappings;
    }
    // @ts-ignore
    return (await originalIndicesCreate.bind(esClient.indices)(params_)).body;
  };

  const originalIndicesPutMapping = esClient.indices.putMapping;
  // @ts-ignore
  esClient.indices.putMapping = async (params: any) => {
    let params_ = { ...params };
    if (params_.properties) {
      if (!params_.body) {
        params_.body = {};
      }
      params_.body.properties = params_.properties;
      delete params_.properties;
    }

    // @ts-ignore
    return (await originalIndicesPutMapping.bind(esClient.indices)(params_))
      .body;
  };

  const originalIndicesPutAlias = esClient.indices.putAlias;
  // @ts-ignore
  esClient.indices.putAlias = async (params: any) => {
    let params_ = { ...params };
    if (params_.is_write_index) {
      if (!params_.body) {
        params_.body = {};
      }
      params_.body.is_write_index = params_.is_write_index;
      delete params_.is_write_index;
    }

    // @ts-ignore
    return (await originalIndicesPutAlias.bind(esClient.indices)(params_)).body;
  };
}

export const traceIndexId = ({
  traceId,
  projectId,
}: {
  traceId: string;
  projectId: string;
}) => `${projectId}/${traceId}`;

export const spanIndexId = ({
  spanId,
  projectId,
}: {
  spanId: string;
  projectId: string;
}) => `${projectId}/${spanId}`;

export const traceCheckIndexId = ({
  traceId,
  checkId,
  projectId,
}: {
  traceId: string;
  checkId: string;
  projectId: string;
}) => `${projectId}/${traceId}/${checkId}`;

export const eventIndexId = ({
  eventId,
  projectId,
}: {
  eventId: string;
  projectId: string;
}) => `${projectId}/${eventId}`;

export const dspyStepIndexId = ({
  projectId,
  runId,
  index,
}: {
  projectId: string;
  runId: string;
  index: string;
}) => `${projectId}/${runId}/${index}`;
