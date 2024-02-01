import {
  EVENTS_INDEX,
  TRACE_CHECKS_INDEX,
  TRACE_INDEX,
  esClient,
} from "../server/elasticsearch";
import {
  type ElasticSearchEvent,
  type Trace,
  type TraceCheck,
} from "../server/tracer/types";

const migrateTraces = async () => {
  const result = await esClient.search<Trace>({
    index: TRACE_INDEX,
    _source: {
      excludes: ["input", "output", "search_embeddings"],
    },
    body: {
      query: {
        //@ts-ignore
        bool: {
          must_not: {
            exists: {
              field: "metadata",
            },
          },
        },
      },
      size: 10_000,
    },
  });

  const totalRecords = result.hits.hits.length;

  const bulkActions = [];
  for (let i = 0; i < totalRecords; i++) {
    const hit = result.hits.hits[i];
    if (!hit) continue;
    const trace = hit._source;
    if (!trace) continue;

    bulkActions.push({ update: { _index: TRACE_INDEX, _id: hit._id } });

    bulkActions.push({
      script: {
        source: `
          if (ctx._source.metadata == null) {
            ctx._source.metadata = new HashMap();
          }
          if (ctx._source.user_id != null) {
            ctx._source.metadata.user_id = ctx._source.user_id;
            ctx._source.remove('user_id');
          }
          if (ctx._source.thread_id != null) {
            ctx._source.metadata.thread_id = ctx._source.thread_id;
            ctx._source.remove('thread_id');
          }
          if (ctx._source.customer_id != null) {
            ctx._source.metadata.customer_id = ctx._source.customer_id;
            ctx._source.remove('customer_id');
          }
          if (ctx._source.labels != null) {
            ctx._source.metadata.labels = ctx._source.labels;
            ctx._source.remove('labels');
          }
          if (ctx._source.topics != null) {
            ctx._source.metadata.topics = ctx._source.topics;
            ctx._source.remove('topics');
          }
        `,
        lang: "painless",
      },
    });

    process.stdout.write(`\r${i + 1}/${totalRecords} records to be updated`);
  }

  if (bulkActions.length > 0) {
    try {
      await esClient.bulk({ body: bulkActions });
    } catch (error) {
      console.error("Error in bulk update:", error);
    }
  }
};

const migrateTraceChecks = async () => {
  const result = await esClient.search<TraceCheck>({
    index: TRACE_CHECKS_INDEX,
    body: {
      query: {
        //@ts-ignore
        bool: {
          must_not: {
            exists: {
              field: "trace_metadata",
            },
          },
        },
      },
      size: 10_000,
    },
  });

  const totalRecords = result.hits.hits.length;

  const bulkActions = [];
  for (let i = 0; i < totalRecords; i++) {
    const hit = result.hits.hits[i];
    if (!hit) continue;
    const item = hit._source;
    if (!item) continue;

    bulkActions.push({ update: { _index: TRACE_CHECKS_INDEX, _id: hit._id } });

    bulkActions.push({
      script: {
        source: `
          if (ctx._source.trace_metadata == null) {
            ctx._source.trace_metadata = new HashMap();
          }
          if (ctx._source.user_id != null) {
            ctx._source.trace_metadata.user_id = ctx._source.user_id;
            ctx._source.remove('user_id');
          }
          if (ctx._source.thread_id != null) {
            ctx._source.trace_metadata.thread_id = ctx._source.thread_id;
            ctx._source.remove('thread_id');
          }
          if (ctx._source.customer_id != null) {
            ctx._source.trace_metadata.customer_id = ctx._source.customer_id;
            ctx._source.remove('customer_id');
          }
          if (ctx._source.labels != null) {
            ctx._source.trace_metadata.labels = ctx._source.labels;
            ctx._source.remove('labels');
          }
          if (ctx._source.topics != null) {
            ctx._source.trace_metadata.topics = ctx._source.topics;
            ctx._source.remove('topics');
          }
        `,
        lang: "painless",
      },
    });

    process.stdout.write(`\r${i + 1}/${totalRecords} records to be updated`);
  }

  if (bulkActions.length > 0) {
    try {
      await esClient.bulk({ body: bulkActions });
    } catch (error) {
      console.error("Error in bulk update:", error);
    }
  }
};

const migrateEvents = async () => {
  const result = await esClient.search<ElasticSearchEvent>({
    index: EVENTS_INDEX,
    body: {
      query: {
        //@ts-ignore
        bool: {
          must_not: {
            exists: {
              field: "trace_metadata",
            },
          },
        },
      },
      size: 10_000,
    },
  });

  const totalRecords = result.hits.hits.length;

  const bulkActions = [];
  for (let i = 0; i < totalRecords; i++) {
    const hit = result.hits.hits[i];
    if (!hit) continue;
    const item = hit._source;
    if (!item) continue;

    bulkActions.push({ update: { _index: EVENTS_INDEX, _id: hit._id } });

    bulkActions.push({
      script: {
        source: `
          if (ctx._source.trace_metadata == null) {
            ctx._source.trace_metadata = new HashMap();
          }
          if (ctx._source.user_id != null) {
            ctx._source.trace_metadata.user_id = ctx._source.user_id;
            ctx._source.remove('user_id');
          }
          if (ctx._source.thread_id != null) {
            ctx._source.trace_metadata.thread_id = ctx._source.thread_id;
            ctx._source.remove('thread_id');
          }
          if (ctx._source.customer_id != null) {
            ctx._source.trace_metadata.customer_id = ctx._source.customer_id;
            ctx._source.remove('customer_id');
          }
          if (ctx._source.labels != null) {
            ctx._source.trace_metadata.labels = ctx._source.labels;
            ctx._source.remove('labels');
          }
          if (ctx._source.topics != null) {
            ctx._source.trace_metadata.topics = ctx._source.topics;
            ctx._source.remove('topics');
          }
        `,
        lang: "painless",
      },
    });

    process.stdout.write(`\r${i + 1}/${totalRecords} records to be updated`);
  }

  if (bulkActions.length > 0) {
    try {
      await esClient.bulk({ body: bulkActions });
    } catch (error) {
      console.error("Error in bulk update:", error);
    }
  }
};

export default async function execute() {
  console.log("\nMigrating Traces");
  await migrateTraces();
  console.log("\nMigrating Trace Checks");
  await migrateTraceChecks();
  console.log("\nMigrating Events");
  await migrateEvents();
}
