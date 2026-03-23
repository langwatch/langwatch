import type { Client as ElasticClient } from "@elastic/elasticsearch";
import { truncateLeafStrings } from "../../utils/truncate";

/**
 * Patches an Elasticsearch client so that every write operation (`index`,
 * `update`, `bulk`) automatically truncates leaf strings in the body to
 * satisfy the 32,766-byte Lucene term limit for flattened fields.
 *
 * This is the **single point** where ES-specific truncation happens.
 * ClickHouse has no such limit and needs no truncation.
 */
export const patchForFlattenedFieldTruncation = (
  esClient: ElasticClient,
): void => {
  // --- index ---
  const originalIndex = esClient.index.bind(esClient);
  // @ts-ignore — same pattern used by patchForOpensearchCompatibility
  esClient.index = async (params: any, ...rest: any[]) => {
    if (params?.body) {
      params = { ...params, body: truncateLeafStrings(params.body) };
    }
    return originalIndex(params, ...rest);
  };

  // --- update ---
  const originalUpdate = esClient.update.bind(esClient);
  // @ts-ignore
  esClient.update = async (params: any, ...rest: any[]) => {
    if (params?.body) {
      const body = { ...params.body };
      // Truncate doc (partial document upserts)
      if (body.doc) {
        body.doc = truncateLeafStrings(body.doc);
      }
      // Truncate upsert (initial document if not exists)
      if (body.upsert) {
        body.upsert = truncateLeafStrings(body.upsert);
      }
      // Truncate script params (used by Painless upsert scripts)
      if (body.script?.params) {
        body.script = {
          ...body.script,
          params: truncateLeafStrings(body.script.params),
        };
      }
      params = { ...params, body };
    }
    return originalUpdate(params, ...rest);
  };

  // --- bulk ---
  const originalBulk = esClient.bulk.bind(esClient);
  // @ts-ignore
  esClient.bulk = async (params: any, ...rest: any[]) => {
    if (params?.body && Array.isArray(params.body)) {
      params = {
        ...params,
        body: params.body.map((item: unknown, idx: number) => {
          // Bulk body alternates: action line, document line.
          // Action lines (index/create/update/delete) are at even indices.
          // Document lines are at odd indices — these need truncation.
          if (idx % 2 === 1 && typeof item === "object" && item !== null) {
            return truncateLeafStrings(item);
          }
          return item;
        }),
      };
    }
    return originalBulk(params, ...rest);
  };
};
