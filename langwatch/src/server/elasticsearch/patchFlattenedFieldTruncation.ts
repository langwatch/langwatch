import type {
  Client as ElasticClient,
  TransportRequestOptions,
  estypesWithBody as TB,
  estypes as T,
} from "@elastic/elasticsearch";
import { truncateLeafStrings } from "../../utils/truncate";

const PATCHED_SYMBOL = Symbol.for("langwatch:flattenedFieldTruncation");

/**
 * Patches an Elasticsearch client so that every write operation (`index`,
 * `update`, `bulk`) automatically truncates leaf strings in the body to
 * satisfy the 32,766-byte Lucene term limit for flattened fields.
 *
 * This is the **single point** where ES-specific truncation happens.
 * ClickHouse has no such limit and needs no truncation.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export const patchForFlattenedFieldTruncation = (
  esClient: ElasticClient,
): void => {
  const client = esClient as unknown as Record<symbol, unknown>;
  if (client[PATCHED_SYMBOL]) return;
  client[PATCHED_SYMBOL] = true;

  // --- index ---
  const originalIndex = esClient.index.bind(esClient);
  esClient.index = (<TDocument>(
    params: TB.IndexRequest<TDocument>,
    options?: TransportRequestOptions,
  ): Promise<T.IndexResponse> => {
    if (params.body) {
      params = { ...params, body: truncateLeafStrings(params.body) };
    }
    return originalIndex(params, options) as Promise<T.IndexResponse>;
  }) as typeof esClient.index;

  // --- update ---
  const originalUpdate = esClient.update.bind(esClient);
  esClient.update = (<TDocument, TPartialDocument>(
    params: TB.UpdateRequest<TDocument, TPartialDocument>,
    options?: TransportRequestOptions,
  ): Promise<T.UpdateResponse<TDocument>> => {
    if (params.body) {
      const body = { ...params.body };
      if (body.doc) {
        body.doc = truncateLeafStrings(body.doc);
      }
      if (body.upsert) {
        body.upsert = truncateLeafStrings(body.upsert);
      }
      if (body.script && typeof body.script === "object" && "params" in body.script && body.script.params) {
        body.script = {
          ...body.script,
          params: truncateLeafStrings(body.script.params),
        };
      }
      params = { ...params, body };
    }
    return originalUpdate(params, options) as Promise<T.UpdateResponse<TDocument>>;
  }) as typeof esClient.update;

  // --- bulk ---
  const originalBulk = esClient.bulk.bind(esClient);
  esClient.bulk = (<TDocument, TPartialDocument>(
    params: TB.BulkRequest<TDocument, TPartialDocument>,
    options?: TransportRequestOptions,
  ): Promise<T.BulkResponse> => {
    if (params.body && Array.isArray(params.body)) {
      const truncatedBody = params.body.map((item, idx) => {
        // Bulk body alternates: action line, document line.
        // Action lines (index/create/update/delete) are at even indices.
        // Document lines are at odd indices — these need truncation.
        if (idx % 2 === 1 && typeof item === "object" && item !== null) {
          return truncateLeafStrings(item);
        }
        return item;
      });
      params = { ...params, body: truncatedBody as typeof params.body };
    }
    return originalBulk(params, options) as Promise<T.BulkResponse>;
  }) as typeof esClient.bulk;
};
