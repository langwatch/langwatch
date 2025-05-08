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
  esClient.search = async function patchedSearch(params, options) {
    // Clone the params to avoid modifying the original
    if (params) {
      const modifiedParams = JSON.parse(JSON.stringify(params));

      // Handle top-level query parameter (needs to be inside body)
      if (modifiedParams.query && !modifiedParams.body) {
        modifiedParams.body = { query: modifiedParams.query };
        delete modifiedParams.query;
      }

      // Handle top-level aggs parameter (needs to be inside body)
      if (modifiedParams.aggs && !modifiedParams.body) {
        modifiedParams.body = modifiedParams.body || {};
        modifiedParams.body.aggs = modifiedParams.aggs;
        delete modifiedParams.aggs;
      } else if (modifiedParams.aggs && modifiedParams.body) {
        modifiedParams.body.aggs = modifiedParams.aggs;
        delete modifiedParams.aggs;
      }

      // Handle top-level sort parameter (needs to be inside body)
      if (modifiedParams.sort) {
        if (!modifiedParams.body) {
          modifiedParams.body = {};
        }

        // Ensure sort is properly formatted
        if (Array.isArray(modifiedParams.sort)) {
          // Format each sort item if it's an array of sort instructions

          modifiedParams.body.sort = modifiedParams.sort.map(
            (sortItem: unknown) => {
              // If sort item is an object like { field: { order: 'asc' } }
              if (
                typeof sortItem === "object" &&
                sortItem !== null &&
                !Array.isArray(sortItem)
              ) {
                const sortItemObj = sortItem as Record<string, unknown>;
                const field = Object.keys(sortItemObj)[0];
                if (!field) return sortItem;

                const options = sortItemObj[field];
                // If the options is an object, it's already in the right format
                if (typeof options === "object" && options !== null) {
                  return { [field]: options };
                } else {
                  // If options is just 'asc' or 'desc', format it properly
                  return { [field]: { order: options } };
                }
              }
              return sortItem;
            }
          );

        } else if (
          typeof modifiedParams.sort === "object" &&
          modifiedParams.sort !== null
        ) {
          // If sort is a single object, put it in an array
          modifiedParams.body.sort = [modifiedParams.sort];
        } else {
          // Simple string or other type
          modifiedParams.body.sort = modifiedParams.sort;
        }

        delete modifiedParams.sort;
      }

      // Check if this is a bool/must query and normalize it if needed
      if (modifiedParams.body?.query?.bool?.must) {
        // Handle single item in must (convert to array if needed)
        if (!Array.isArray(modifiedParams.body.query.bool.must)) {
          modifiedParams.body.query.bool.must = [
            modifiedParams.body.query.bool.must,
          ];
        }
      }

      // Call original with modified params but same options
      // @ts-ignore
      return (await originalSearch(modifiedParams, options)).body;
    }

    // If no params, just pass through to original
    // @ts-ignore
    return (await originalSearch(params, options)).body;
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
