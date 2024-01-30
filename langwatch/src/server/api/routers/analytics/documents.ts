import { SPAN_INDEX, TRACE_INDEX, esClient } from "../../../elasticsearch";
import type { Trace } from "../../../tracer/types";
import { TeamRoleGroup, checkUserPermissionForProject } from "../../permission";
import { protectedProcedure } from "../../trpc";
import {
  currentVsPreviousDates,
  generateTraceQueryConditions,
  sharedAnalyticsFilterInput,
  spanQueryConditions,
} from "./common";

export const topUsedDocuments = protectedProcedure
  .input(sharedAnalyticsFilterInput)
  .use(checkUserPermissionForProject(TeamRoleGroup.COST_VIEW))
  .query(async ({ input }) => {
    const { previousPeriodStartDate } = currentVsPreviousDates(input);

    const tracesResult = await esClient.search<Trace>({
      index: TRACE_INDEX,
      body: {
        _source: ["trace_id"],
        size: 10000,
        query: {
          bool: {
            //@ts-ignore
            filter: generateTraceQueryConditions({
              ...input,
              startDate: previousPeriodStartDate.getTime(),
            }),
          },
        },
      },
    });

    const traceIds = tracesResult.hits.hits.map((hit) => hit._source!.trace_id);

    const result = await esClient.search({
      index: SPAN_INDEX,
      size: 0,
      body: {
        query: {
          //@ts-ignore
          bool: {
            filter: [
              ...spanQueryConditions({
                ...input,
                startDate: previousPeriodStartDate.getTime(),
                traceIds,
              }),
            ],
          },
        },
        aggs: {
          documents: {
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
                  top_content: {
                    top_hits: {
                      size: 1,
                      _source: {
                        includes: ["contexts.content"],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const topDocuments = (
      result.aggregations?.documents as any
    )?.top_documents.buckets.map((bucket: any) => ({
      documentId: bucket.key,
      count: bucket.doc_count,
      content: bucket.top_content.hits.hits[0]._source.content,
    })) as { documentId: string; count: number; content: string }[];

    const totalUniqueDocuments = (
      (result.aggregations?.documents as any)?.total_unique_documents
    )?.value as number;

    return {
      topDocuments,
      totalUniqueDocuments,
    };
  });
