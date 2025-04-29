import { type Client as ElasticClient } from "@elastic/elasticsearch";

export const patchForOpensearchCompatibility = (esClient: ElasticClient) => {
  const originalExists = esClient.indices.exists.bind(esClient.indices);
  // @ts-ignore
  esClient.indices.exists = async (...params) => {
    // @ts-ignore
    return (await originalExists(...params)).body;
  };

  const originalSearch = esClient.search.bind(esClient);
  // @ts-ignore
  esClient.search = async (...params) => {
    // @ts-ignore
    return (await originalSearch(...params)).body;
  };

  const originalGet = esClient.get.bind(esClient);
  // @ts-ignore
  esClient.get = async (...params) => {
    // @ts-ignore
    return (await originalGet(...params)).body;
  };

  const originalGetSource = esClient.getSource.bind(esClient);
  // @ts-ignore
  esClient.getSource = async (...params) => {
    // @ts-ignore
    return (await originalGetSource(...params)).body;
  };

  const originalCatIndices = esClient.cat.indices.bind(esClient.cat);
  // @ts-ignore
  esClient.cat.indices = async (...params) => {
    // @ts-ignore
    return (await originalCatIndices(...params)).body;
  };

  const originalIndicesCreate = esClient.indices.create.bind(esClient.indices);
  // @ts-ignore
  esClient.indices.create = async (params: any) => {
    const params_ = { ...params };
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
    return (await originalIndicesCreate(params_)).body;
  };

  const originalIndicesPutMapping = esClient.indices.putMapping.bind(
    esClient.indices
  );
  // @ts-ignore
  esClient.indices.putMapping = async (params: any) => {
    const params_ = { ...params };
    if (params_.properties) {
      if (!params_.body) {
        params_.body = {};
      }
      params_.body.properties = params_.properties;
      delete params_.properties;
    }

    const result = await originalIndicesPutMapping(params_);
    // @ts-ignore
    return result.body;
  };

  const originalIndicesPutAlias = esClient.indices.putAlias.bind(
    esClient.indices
  );
  // @ts-ignore
  esClient.indices.putAlias = async (params: any) => {
    const params_ = { ...params };
    if (params_.is_write_index) {
      if (!params_.body) {
        params_.body = {};
      }
      params_.body.is_write_index = params_.is_write_index;
      delete params_.is_write_index;
    }

    // @ts-ignore
    return (await originalIndicesPutAlias(params_)).body;
  };

  const originalIndicesGetAlias = esClient.indices.getAlias.bind(
    esClient.indices
  );
  // @ts-ignore
  esClient.indices.getAlias = async (params: any) => {
    const params_ = { ...params };
    // @ts-ignore
    return (await originalIndicesGetAlias(params_)).body;
  };

  const originalBulk = esClient.bulk.bind(esClient);
  // @ts-ignore
  esClient.bulk = async (params: any) => {
    // @ts-ignore
    return (await originalBulk(params)).body;
  };
};
