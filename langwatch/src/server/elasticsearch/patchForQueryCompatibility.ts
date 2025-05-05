import { type Client as ElasticClient } from "@elastic/elasticsearch";

export function patchForQueryCompatibility(client: ElasticClient): void {
  const originalSearch = client.search.bind(client);

  // @ts-expect-error -- We're intentionally replacing the search method
  client.search = async function patchedSearch(params, options) {
    console.log("params", params);
    // Clone the params to avoid modifying the original
    if (params) {
      const modifiedParams = JSON.parse(JSON.stringify(params));

      // Handle top-level query parameter (needs to be inside body)
      if (modifiedParams.query && !modifiedParams.body) {
        modifiedParams.body = { query: modifiedParams.query };
        delete modifiedParams.query;
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
      return await originalSearch(modifiedParams, options);
    }

    // If no params, just pass through to original
    return await originalSearch(params, options);
  };
}
