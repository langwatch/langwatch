import { TRACE_INDEX, esClient } from "../../../elasticsearch";
import { TeamRoleGroup, checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import { generateTracesPivotQueryConditions } from "./common";
import { sharedFiltersInputSchema } from "../../../analytics/types";
import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import type { ElasticSearchTrace } from "../../../tracer/types";

export const topUsedDocuments = protectedProcedure
  .input(sharedFiltersInputSchema)
  .use(checkUserPermissionForProject(TeamRoleGroup.COST_VIEW))
  .query(async ({ input }) => {
    const { pivotIndexConditions } = generateTracesPivotQueryConditions(input);

    const client = await esClient(input.projectId);
    const result = (await client.search<ElasticSearchTrace>({
      index: TRACE_INDEX.alias,
      size: 0,
      body: {
        query: pivotIndexConditions,
        aggs: {
          nested: {
            nested: {
              path: "spans",
            },
            aggs: {
              total_unique_documents: {
                cardinality: {
                  field: "spans.contexts.document_id",
                },
              },
              top_documents: {
                terms: {
                  field: "spans.contexts.document_id",
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
                            includes: ["trace_id"],
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
            bucket.back_to_root.top_content.hits.hits[0]._source.trace_id,
        })
      ) as { documentId: string; count: number; traceId: string }[];

    const totalUniqueDocuments = result.aggregations?.nested
      ?.total_unique_documents?.value as number;

    // we now need to query spans to get the actual documents content

    const documents = await client.search<ElasticSearchTrace>({
      index: TRACE_INDEX.alias,
      size: topDocuments.reduce((acc, d) => acc + d.count, 0),
      body: {
        query: {
          bool: {
            must: [
              {
                nested: {
                  path: "spans",
                  query: {
                    terms: {
                      "spans.contexts.document_id": topDocuments.map(
                        (d) => d.documentId
                      ),
                    },
                  },
                },
              },
              {
                terms: {
                  trace_id: topDocuments.map((d) => d.traceId),
                },
              },
            ] as QueryDslQueryContainer[],
          } as QueryDslBoolQuery,
        },
        _source: ["spans.contexts.document_id", "spans.contexts.content"],
      },
    });

    const documentIdToContent: Record<string, string> = {};
    for (const hit of documents.hits.hits) {
      for (const span of hit._source!.spans ?? []) {
        for (const context of span.contexts ?? []) {
          const documentId = context.document_id;
          if (typeof documentId === "string") {
            documentIdToContent[documentId] =
              typeof context.content === "string"
                ? context.content
                : JSON.stringify(context.content);
          }
        }
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
