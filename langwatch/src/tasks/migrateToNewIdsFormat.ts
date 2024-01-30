import {
  EVENTS_INDEX,
  SPAN_INDEX,
  TRACE_CHECKS_INDEX,
  TRACE_INDEX,
  esClient,
  eventIndexId,
  spanIndexId,
  traceCheckIndexId,
  traceIndexId,
} from "../server/elasticsearch";
import {
  type ElasticSearchSpan,
  type Trace,
  type TraceCheck,
  type Event,
} from "../server/tracer/types";

const migrateTraces = async () => {
  const result = await esClient.search<Trace>({
    index: TRACE_INDEX,
    body: {
      query: {
        exists: {
          field: "id",
        },
      },
      size: 10_000,
    },
  });

  const totalRecords = result.hits.hits.length;

  for (let i = 0; i < totalRecords; i++) {
    const hit = result.hits.hits[i];
    if (!hit) continue;
    const trace:
      | (Trace & {
          id?: string | undefined;
          trace_id?: string | undefined;
        })
      | undefined = hit._source;
    if (!trace) continue;

    if (trace.id && !trace.trace_id) {
      const traceWithoutId = { ...trace, trace_id: trace.id ?? trace.trace_id };
      delete traceWithoutId.id;

      await esClient.index({
        index: TRACE_INDEX,
        id: traceIndexId({
          traceId: trace.id ?? trace.trace_id,
          projectId: trace.project_id,
        }),
        body: traceWithoutId,
        refresh: true,
      });

      await esClient.delete({
        index: TRACE_INDEX,
        id: hit._id,
        refresh: true,
      });
    }

    process.stdout.write(`\r${i + 1}/${totalRecords} records updated`);
  }
};

const migrateSpans = async () => {
  const result = await esClient.search<ElasticSearchSpan>({
    index: SPAN_INDEX,
    body: {
      query: {
        exists: {
          field: "id",
        },
      },
      size: 10_000,
    },
  });

  const totalRecords = result.hits.hits.length;

  for (let i = 0; i < totalRecords; i++) {
    const hit = result.hits.hits[i];
    if (!hit) continue;
    const span:
      | (ElasticSearchSpan & {
          id?: string | undefined;
          span_id?: string | undefined;
        })
      | undefined = hit._source;
    if (!span) continue;

    if (span.id && !span.span_id) {
      const spanWithoutId = { ...span, span_id: span.id ?? span.span_id };
      delete spanWithoutId.id;

      await esClient.index({
        index: SPAN_INDEX,
        id: spanIndexId({
          spanId: span.id ?? span.span_id,
          projectId: span.project_id,
        }),
        body: spanWithoutId,
        refresh: true,
      });

      try {
        await esClient.delete({
          index: SPAN_INDEX,
          id: hit._id,
          routing: span.trace_id,
          refresh: true,
        });
      } catch (e: any) {
        try {
          await esClient.delete({
            index: SPAN_INDEX,
            id: hit._id,
            refresh: true,
          });
        } catch (e: any) {
          if (!e.toString().includes("not_found")) {
            throw e;
          }
          console.log("not found");
        }
      }
    }

    process.stdout.write(`\r${i + 1}/${totalRecords} records updated`);
  }
};

const migrateTraceChecks = async () => {
  const result = await esClient.search<TraceCheck>({
    index: TRACE_CHECKS_INDEX,
    body: {
      query: {
        exists: {
          field: "id",
        },
      },
      size: 10_000,
    },
  });

  const totalRecords = result.hits.hits.length;

  for (let i = 0; i < totalRecords; i++) {
    const hit = result.hits.hits[i];
    if (!hit) continue;
    const traceCheck:
      | (TraceCheck & {
          id?: string | undefined;
        })
      | undefined = hit._source;
    if (!traceCheck) continue;

    if (traceCheck.id && !traceCheck.trace_id) {
      const traceCheckWithoutId = { ...traceCheck };
      delete traceCheckWithoutId.id;

      await esClient.index({
        index: TRACE_CHECKS_INDEX,
        id: traceCheckIndexId({
          traceId: traceCheck.id ?? traceCheck.trace_id,
          checkId: traceCheck.check_id,
          projectId: traceCheck.project_id,
        }),
        body: traceCheckWithoutId,
        refresh: true,
      });

      try {
        await esClient.delete({
          index: TRACE_CHECKS_INDEX,
          id: hit._id,
          refresh: true,
        });
      } catch (e: any) {
        if (!e.toString().includes("not_found")) {
          throw e;
        }
      }
    }

    process.stdout.write(`\r${i + 1}/${totalRecords} records updated`);
  }
};

const migrateEvents = async () => {
  const result = await esClient.search<Event>({
    index: EVENTS_INDEX,
    body: {
      query: {
        exists: {
          field: "id",
        },
      },
      size: 10_000,
    },
  });

  const totalRecords = result.hits.hits.length;

  for (let i = 0; i < totalRecords; i++) {
    const hit = result.hits.hits[i];
    if (!hit) continue;
    const event:
      | (Event & {
          id?: string | undefined;
          event_id?: string | undefined;
        })
      | undefined = hit._source;
    if (!event) continue;

    if (event.id && !event.event_id) {
      const eventWithoutId = { ...event, event_id: event.id ?? event.event_id };
      delete eventWithoutId.id;

      await esClient.index({
        index: EVENTS_INDEX,
        id: eventIndexId({
          eventId: event.id ?? event.event_id,
          projectId: event.project_id,
        }),
        body: eventWithoutId,
        refresh: true,
      });

      try {
        await esClient.delete({
          index: EVENTS_INDEX,
          id: hit._id,
          refresh: true,
        });
      } catch (e: any) {
        if (
          !e.toString().includes("not_found") ||
          !e.toString().includes("document_missing_exception")
        ) {
          throw e;
        }
        console.log("not found");
      }
    }

    process.stdout.write(`\r${i + 1}/${totalRecords} records updated`);
  }
};

export default async function execute() {
  console.log("\nMigrating Traces");
  await migrateTraces();
  console.log("\nMigrating Spans");
  await migrateSpans();
  console.log("\nMigrating Trace Checks");
  await migrateTraceChecks();
  console.log("\nMigrating Events");
  await migrateEvents();
}
