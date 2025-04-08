import {
  type QueryDslBoolQuery,
  type QueryDslQueryContainer,
  type SearchResponse,
} from "@elastic/elasticsearch/lib/api/types";
import { Client as ElasticClient } from "@elastic/elasticsearch";

import { esClient, TRACE_INDEX } from "../../src/server/elasticsearch";

export const migrate = async (client: ElasticClient) => {
  let searchAfter: unknown[] | undefined;
  let response: SearchResponse<{ trace_id: string }>;
  let bulkActions = [];

  do {
    const query: QueryDslQueryContainer = {
      bool: {
        must: [
          {
            bool: {
              should: [
                { exists: { field: "input.embeddings" } },
                { exists: { field: "output.embeddings" } },
              ],
            },
          },
        ],
      } as QueryDslBoolQuery,
    };

    response = await client.search<{ trace_id: string }>({
      index: TRACE_INDEX.alias,
      _source: {
        includes: ["trace_id"],
      },
      body: {
        query: query,
        size: 5_000,
        sort: ["_doc"],
        ...(searchAfter ? { search_after: searchAfter } : {}),
      },
    });

    const results = response.hits.hits;
    process.stdout.write(`\nFetched ${results.length} more hits`);

    const count = await client.count({
      index: TRACE_INDEX.alias,
      body: {
        query: query,
      },
    });

    searchAfter = results[results.length - 1]?.sort;
    process.stdout.write(` from ${count.count} total\n`);

    for (let i = 0; i < results.length; i++) {
      const hit = results[i];
      if (!hit) continue;

      bulkActions.push({
        update: {
          _index: TRACE_INDEX.alias,
          _id: hit._id,
        },
      });
      bulkActions.push({
        script: {
          source: `
            if (ctx._source.input != null) {
              ctx._source.input.remove('embeddings');
            }
            if (ctx._source.output != null) {
              ctx._source.output.remove('embeddings');
            }
          `,
          lang: "painless",
        },
      });

      process.stdout.write(`\r${i + 1}/${results.length} being updated`);

      if (bulkActions.length >= 400) {
        await client.bulk({ body: bulkActions });
        bulkActions = [];
      }
    }

    if (bulkActions.length > 0) {
      await client.bulk({ body: bulkActions });
    }
  } while (response.hits.hits.length > 0);
};
