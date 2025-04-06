import { esClient, TRACE_INDEX } from "../../src/server/elasticsearch";
import { getCurrentWriteIndex } from "../helpers";
import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";

import { Client as ElasticClient } from "@elastic/elasticsearch";

export const migrate = async (_migrationKey: string, client: ElasticClient) => {
  const currentIndex = await getCurrentWriteIndex({
    indexSpec: TRACE_INDEX,
  });

  await client.indices.putMapping({
    index: currentIndex,
    properties: {
      evaluations: {
        type: "nested",
        properties: {
          evaluation_id: {
            type: "keyword",
          },
          evaluator_id: {
            type: "keyword",
          },
          name: {
            type: "keyword",
          },
          type: {
            type: "keyword",
          },
        },
      },
    },
  });

  let searchAfter: any;
  let response;
  do {
    response = await client.search({
      index: currentIndex,
      _source: {
        includes: ["evaluations"],
      },
      body: {
        query: {
          nested: {
            path: "evaluations",
            query: {
              bool: {
                must: {
                  exists: {
                    field: "evaluations.check_id",
                  },
                },
                must_not: {
                  exists: {
                    field: "evaluations.evaluation_id",
                  },
                } as QueryDslQueryContainer,
              } as QueryDslBoolQuery,
            },
          },
        },
        size: 5_000,
        sort: ["_doc"],
        ...(searchAfter ? { search_after: searchAfter } : {}),
      },
    });
    const results = response.hits.hits;
    searchAfter = results[results.length - 1]?.sort;
    const totalHits = (response.hits as any).total.value;
    process.stdout.write(
      `\rFetched ${results.length} out of ${totalHits}${
        totalHits >= 10_000 ? "+" : ""
      } total hits`
    );
    console.log("");

    let bulkActions = [];
    for (let i = 0; i < results.length; i++) {
      const hit = results[i];
      if (!hit) continue;
      const item = hit._source;
      if (!item) continue;

      bulkActions.push({
        update: {
          _index: currentIndex,
          _id: hit._id,
        },
      });

      bulkActions.push({
        script: {
          source: `
          if (ctx._source.evaluations != null) {
            for (evaluation in ctx._source.evaluations) {
              if (evaluation.check_id != null) {
                evaluation.evaluation_id = evaluation.check_id;
                evaluation.evaluator_id = evaluation.check_id;
                evaluation.remove('check_id');
              }
              if (evaluation.check_name != null) {
                evaluation.name = evaluation.check_name;
                evaluation.remove('check_name');
              }
              if (evaluation.check_type != null) {
                evaluation.type = evaluation.check_type;
                evaluation.remove('check_type');
              }
              if (evaluation.trace_id != null) {
                evaluation.remove('trace_id');
              }
              if (evaluation.project_id != null) {
                evaluation.remove('project_id');
              }
              if (evaluation.id != null) {
                evaluation.remove('id');
              }
            }
          }
        `,
          lang: "painless",
        },
      });

      process.stdout.write(
        `\r${i + 1}/${results.length} records to be updated`
      );

      if (bulkActions.length >= 1000) {
        const result = await client.bulk({ body: bulkActions });
        bulkActions = [];
        if (result.errors) {
          throw new Error(
            "Error in bulk update:\n" + JSON.stringify(result, null, 2)
          );
        }
      }
    }

    if (bulkActions.length > 0) {
      const result = await client.bulk({ body: bulkActions });
      if (result.errors) {
        throw new Error(
          "Error in bulk update:\n" + JSON.stringify(result, null, 2)
        );
      }
    }
    console.log("");
  } while (response.hits.hits.length > 0);
};
