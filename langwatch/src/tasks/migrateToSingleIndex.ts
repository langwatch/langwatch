import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import { TRACE_INDEX, esClient } from "../server/elasticsearch";
import type {
  ElasticSearchEvent,
  ElasticSearchSpan,
  ElasticSearchTrace,
  TraceCheck,
} from "../server/tracer/types";

const EVENTS_INDEX = "search-events";
const SPAN_INDEX = "search-spans";
const TRACE_CHECKS_INDEX = "search-trace-checks";

const migrateIndex = async (projectId: string, index: string) => {
  console.log("\nMigrating Project", projectId);

  let searchAfter: any;
  let response;
  let bulkActions = [];

  do {
    response = await esClient.search<ElasticSearchTrace>({
      index,
      _source: {
        includes: ["trace_id", "spans"],
      },
      body: {
        query: {
          bool: {
            must: {
              term: {
                project_id: projectId,
              },
            } as QueryDslBoolQuery["must"],
            must_not: {
              nested: {
                path: "spans",
                query: {
                  exists: {
                    field: "spans",
                  },
                },
              },
            } as QueryDslBoolQuery["must_not"],
          } as QueryDslBoolQuery,
        },
        size: 400,
        sort: ["_doc"],
        ...(searchAfter ? { search_after: searchAfter } : {}),
      },
    });
    const results = response.hits.hits;
    searchAfter = results[results.length - 1]?.sort;
    process.stdout.write(
      `\nFetched ${results.length} more hits from ${
        (response as any).hits.total.value
      } total\n`
    );

    const traceIds = results
      .map((result) => result._source?.trace_id)
      .filter((x) => x);

    const spansForTraces = await esClient.search<ElasticSearchSpan>({
      index: SPAN_INDEX,
      body: {
        size: 10_000,
        query: {
          bool: {
            must: [
              {
                term: {
                  project_id: projectId,
                },
              },
              {
                terms: {
                  trace_id: traceIds,
                },
              },
            ] as QueryDslBoolQuery["must"],
          } as QueryDslBoolQuery,
        },
      },
    });

    const spansByTraceId: Record<string, ElasticSearchSpan[]> =
      spansForTraces.hits.hits
        .map((hit) => hit._source!)
        .filter((x) => x)
        .reduce(
          (acc, span) => {
            if (!acc[span.trace_id]) {
              acc[span.trace_id] = [];
            }
            if ("id" in span) {
              delete span.id;
            }
            acc[span.trace_id]!.push(span);
            return acc;
          },
          {} as Record<string, ElasticSearchSpan[]>
        );

    const eventsForTraces = await esClient.search<ElasticSearchEvent>({
      index: EVENTS_INDEX,
      body: {
        size: 10_000,
        query: {
          bool: {
            must: [
              {
                term: {
                  project_id: projectId,
                },
              },
              {
                terms: {
                  trace_id: traceIds,
                },
              },
            ] as QueryDslBoolQuery["must"],
          } as QueryDslBoolQuery,
        },
      },
    });

    const eventsByTraceId: Record<string, ElasticSearchEvent[]> =
      eventsForTraces.hits.hits
        .map((hit) => hit._source!)
        .filter((x) => x)
        .reduce(
          (acc, event) => {
            if (!acc[event.trace_id]) {
              acc[event.trace_id] = [];
            }
            if ("id" in event) {
              delete event.id;
            }
            acc[event.trace_id]!.push(event);
            return acc;
          },
          {} as Record<string, ElasticSearchEvent[]>
        );

    const evaluationsForTraces = await esClient.search<TraceCheck>({
      index: TRACE_CHECKS_INDEX,
      body: {
        size: 10_000,
        query: {
          bool: {
            must: [
              {
                term: {
                  project_id: projectId,
                },
              },
              {
                terms: {
                  trace_id: traceIds,
                },
              },
            ] as QueryDslBoolQuery["must"],
          } as QueryDslBoolQuery,
        },
      },
    });

    const evaluationsByTraceId: Record<string, TraceCheck[]> =
      evaluationsForTraces.hits.hits
        .map((hit) => hit._source!)
        .filter((x) => x)
        .reduce(
          (acc, evaluation) => {
            if (!acc[evaluation.trace_id]) {
              acc[evaluation.trace_id] = [];
            }
            if ("id" in evaluation) {
              delete evaluation.id;
            }
            acc[evaluation.trace_id]!.push(evaluation);
            return acc;
          },
          {} as Record<string, TraceCheck[]>
        );

    for (let i = 0; i < results.length; i++) {
      const hit = results[i];
      if (!hit) continue;

      bulkActions.push({
        update: {
          _index: index,
          _id: hit._id,
        },
      });

      const traceId = hit._source?.trace_id ?? "never";
      const events = eventsByTraceId[traceId] ?? [];
      const evaluations = evaluationsByTraceId[traceId] ?? [];

      const updateDoc: Partial<ElasticSearchTrace> = {
        spans: spansByTraceId[traceId] ?? [],
        ...(events && events.length > 0 ? { events } : {}),
        ...(evaluations && evaluations.length > 0 ? { evaluations } : {}),
      };

      bulkActions.push({
        doc: updateDoc,
      });

      process.stdout.write(`\r${i + 1}/${results.length} being updated`);

      if (bulkActions.length >= 400) {
        try {
          await esClient.bulk({ body: bulkActions });
          bulkActions = [];
        } catch (error) {
          console.error("Error in bulk update:", error);
        }
      }
    }

    if (bulkActions.length > 0) {
      try {
        await esClient.bulk({ body: bulkActions });
        bulkActions = [];
      } catch (error) {
        console.error("Error in bulk update:", error);
      }
    }
  } while (response.hits.hits.length > 0);
};

export default async function execute() {
  console.log(
    "\nMigrating all spans, events and evaluations to a single index under traces"
  );
  // Search all unique project_ids within traces
  const projectIdsResults = await esClient.search({
    index: TRACE_INDEX.read_alias,
    body: {
      size: 0,
      aggs: {
        project_ids: {
          terms: {
            field: "project_id",
            size: 10_000,
          },
        },
      },
    },
  });
  const projectIds: string[] = (
    projectIdsResults.aggregations?.project_ids as any
  ).buckets.map((bucket: any) => bucket.key);
  console.log(projectIds.length, "project ids found");

  for (const projectId of projectIds) {
    await migrateIndex(projectId, TRACE_INDEX.write_alias);
  }
}
