import { type Client as ElasticClient } from "@elastic/elasticsearch";

import { env } from "../../env.mjs";

export const patchForQuickwitCompatibility = (esClient: ElasticClient) => {
  const originalSearch = esClient.search.bind(esClient);
  // @ts-ignore
  esClient.count = async (params: any) => {
    // @ts-ignore
    const result = await originalSearch({
      ...params,
      ...{
        size: 0,
        body: { ...params.body, track_total_hits: true },
      },
    });
    return {
      count: result.hits.total,
    };
  };

  // @ts-ignore
  esClient.search = async (...params) => {
    const patchParams = (params: any) => {
      if (typeof params === "object") {
        // quickwit does not support _source in search requests
        if (params.body?._source) {
          delete params.body._source;
        }
        // quickwit does not support format in range queries
        if (params.format === "epoch_millis") {
          delete params.format;
        }
        for (const key in params) {
          patchParams(params[key]);
        }
      } else if (Array.isArray(params)) {
        for (const item of params) {
          patchParams(item);
        }
      }

      return params;
    };

    const result = await originalSearch(...patchParams(params));

    // Remove duplicate items due to quickwit's delayed deletes, whoever has the biggest timestamps.updated_at is kept
    const latestTraceVersions = result.hits.hits.reduce((acc, trace) => {
      const _id = (trace._source as any)?._id;
      if (!_id) {
        acc.set(Math.random().toString(), trace);
        return acc;
      }

      const existingTrace = acc.get(_id);
      if (
        !existingTrace ||
        ((trace._source as any)?.timestamps?.updated_at ?? 0) >
          ((existingTrace._source as any)?.timestamps?.updated_at ?? 0)
      ) {
        acc.set(_id, trace);
      }
      return acc;
    }, new Map<string, (typeof result.hits.hits)[0]>());

    return {
      ...result,
      hits: {
        ...result.hits,
        hits: Array.from(latestTraceVersions.values()),
      },
    };
  };

  type UpdateParams = {
    index: string;
    id: string;
    doc: Record<string, unknown>;
    doc_as_upsert?: boolean;
    upsert?: Record<string, unknown>;
    retry_on_conflict?: number;
  };

  const getDocumentById = async (index: string, id: string) => {
    const searchResult = await originalSearch({
      index,
      body: {
        query: {
          term: {
            _id: id,
          },
        },
      },
      size: 1,
    });

    return searchResult.hits.hits[0]?._source;
  };

  type QuickwitDeleteQuery = {
    query: string;
    start_timestamp?: number;
    end_timestamp?: number;
    search_field?: string[];
  };

  const deleteViaQuickwitApi = async (index: string, id: string) => {
    const currentTimestampSeconds = Math.floor(Date.now() / 1000);

    const deleteQuery: QuickwitDeleteQuery = {
      query: `_id:${id}`,
      end_timestamp: currentTimestampSeconds,
    };

    const quickwitUrl = env.ELASTICSEARCH_NODE_URL?.replace(
      "quickwit://",
      "http://"
    ).replace(/\/api\/v1\/_elastic\/?/, "");
    if (!quickwitUrl) {
      throw new Error("Quickwit URL not configured");
    }

    const response = await fetch(
      `${quickwitUrl}/api/v1/${index}/delete-tasks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(deleteQuery),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete document: ${errorText}`);
    }

    const response_ = await response.json();

    return response_;
  };

  type DeleteParams = {
    index: string;
    id: string;
  };

  // @ts-ignore
  // Quickwit does not support ES delete so we delete via the quickwit api
  esClient.delete = async (params: DeleteParams) => {
    await deleteViaQuickwitApi(params.index, params.id);

    // Return a response similar to Elasticsearch's delete response
    return {
      result: "deleted",
    };
  };

  // @ts-ignore
  // Quickwit does not support update so we delete and re-insert
  esClient.update = async (params: UpdateParams) => {
    const existingDoc = await getDocumentById(params.index, params.id);

    let finalDoc: Record<string, unknown>;

    if (existingDoc) {
      // Merge existing doc with update
      finalDoc = {
        ...existingDoc,
        ...params.doc,
      };
    } else {
      // Handle non-existent document
      if (params.doc_as_upsert ?? params.upsert) {
        finalDoc = params.doc_as_upsert ? params.doc : params.upsert!;
      } else {
        throw new Error(
          `Document with id ${params.id} not found and no upsert provided`
        );
      }
    }

    // Delete existing document if it exists
    if (existingDoc) {
      await esClient.delete({
        index: params.index,
        id: params.id,
      });
    }

    // Insert the new/updated document
    const result = await esClient.index({
      index: params.index,
      id: params.id,
      body: finalDoc,
    });

    return {
      ...result,
      result: existingDoc ? "updated" : "created",
    };
  };

  type IndexParams = {
    index: string;
    id: string;
    body: Record<string, unknown>;
  };

  // @ts-ignore
  // Quickwit does not support indexing a single document so we use bulk here
  esClient.index = async (params: IndexParams) => {
    // Bulk operation requires two lines:
    // 1. Action metadata
    // 2. Document data
    const bulkBody = [
      // Action metadata line
      {
        index: {
          _index: params.index,
          _id: params.id,
        },
      },
      // Document data line
      { _id: params.id, ...params.body },
    ];

    // @ts-ignore
    const result = (await esClient.bulk({
      body: bulkBody,
    })) as any;

    if (result.errors) {
      throw new Error(
        `Bulk operation failed: ${JSON.stringify(result.errors)}`
      );
    }

    return {
      _index: params.index,
      _id: params.id,
      _version: 1,
      result: "created",
      _shards: {
        total: 1,
        successful: 1,
        failed: 0,
      },
      _seq_no: 0,
      _primary_term: 1,
      status: "created",
    };
  };
};
