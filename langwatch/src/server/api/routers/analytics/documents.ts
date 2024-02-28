import {
  SPAN_INDEX,
  TRACES_PIVOT_INDEX,
  esClient,
  traceIndexId,
} from "../../../elasticsearch";
import { TeamRoleGroup, checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import { generateTracesPivotQueryConditions } from "./common";
import { sharedFiltersInputSchema } from "../../../analytics/types";
import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";

export const topUsedDocuments = protectedProcedure
  .input(sharedFiltersInputSchema)
  .use(checkUserPermissionForProject(TeamRoleGroup.COST_VIEW))
  .query(async ({ input }) => {
    const { pivotIndexConditions } = generateTracesPivotQueryConditions(input);

    const result = (await esClient.search({
      index: TRACES_PIVOT_INDEX,
      size: 0,
      body: {
        query: pivotIndexConditions,
        aggs: {
          nested: {
            nested: {
              path: "contexts",
            },
            aggs: {
              total_unique_documents: {
                cardinality: {
                  field: "contexts.document_id",
                },
              },
              top_documents: {
                terms: {
                  field: "contexts.document_id",
                  size: 10,
                },
                aggs: {
                  back_to_root: {
                    reverse_nested: {},
                    aggs: {
                      top_content: {
                        top_hits: {
                          size: 1,
                          _source: {
                            includes: ["trace.trace_id"],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })) as any;

    const topDocuments =
      result.aggregations?.nested?.top_documents?.buckets.map(
        (bucket: any) => ({
          documentId: bucket.key,
          count: bucket.doc_count,
          traceId:
            bucket.back_to_root.top_content.hits.hits[0]._source.trace.trace_id,
        })
      ) as { documentId: string; count: number; traceId: string }[];

    const totalUniqueDocuments = result.aggregations?.nested
      ?.total_unique_documents?.value as number;

    // we now need to query spans to get the actual documents content
    const documents = (await esClient.search({
      index: SPAN_INDEX,
      size: topDocuments.reduce((acc, d) => acc + d.count, 0),
      body: {
        query: {
          bool: {
            must: [
              {
                terms: {
                  "contexts.document_id": topDocuments.map((d) => d.documentId),
                },
              },
              {
                terms: {
                  trace_id: topDocuments.map((d) => d.traceId),
                },
              },
              {
                terms: {
                  _routing: topDocuments.map((d) =>
                    traceIndexId({
                      traceId: d.traceId,
                      projectId: input.projectId,
                    })
                  ),
                },
              },
            ] as QueryDslQueryContainer[],
          } as QueryDslBoolQuery,
        },
        _source: ["contexts.document_id", "contexts.content"],
      },
    })) as any;

    const documentIdToContent: Record<string, string> = {};
    for (const hit of documents.hits.hits) {
      for (const context of hit._source.contexts) {
        documentIdToContent[context.document_id] = context.content;
      }
    }

    const topDocuments_ = topDocuments.map((d) => ({
      ...d,
      content: documentIdToContent[d.documentId],
    }));

    return {
      topDocuments: topDocuments_,
      totalUniqueDocuments,
    };
  });
