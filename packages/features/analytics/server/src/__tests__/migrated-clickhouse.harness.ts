/**
 * A ClickHouse endpoint carrying the *shipped* migrations, for analytics
 * suites that must read the real `trace_summaries` / `stored_spans` /
 * `evaluation_runs` schema rather than a transcription of it.
 *
 * The endpoint comes from `startTestClickHouseEndpoints`, so the suite runs
 * against the always-on native server when one is configured and a reusable
 * container otherwise, and the schema comes from `ClickHouseMigrateTask` —
 * the same goose run production performs. A suite that carried its own DDL
 * would prove the transcription, not the tables the product deploys.
 *
 * Every suite here shares one endpoint name on purpose: the migrations take
 * far longer than the assertions, and per-tenant ids already keep the suites'
 * rows apart. The run is memoised per URL per process for the same reason.
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseMigrateTask, DEFAULT_CLICKHOUSE_SETTINGS } from "@langwatch/clickhouse-client";
import { startTestClickHouseEndpoints } from "@langwatch/test-harness";

/** The one endpoint name every migrated-schema analytics suite asks for. */
const MIGRATED_ENDPOINT_SUITE = "analytics-migrated";

export interface MigratedClickHouse {
  /** Client bound to the migrated database. */
  client: ClickHouseClient;
  /** Connection URL with the migrated database in its path. */
  url: string;
  database: string;
}

const migratedUrls = new Set<string>();
let endpoint: MigratedClickHouse | undefined;

/**
 * Starts (or reuses) the migrated endpoint and returns a client bound to it.
 *
 * `CLICKHOUSE_CLUSTER` is unset for the migration: it switches every engine to
 * its `Replicated` form, which needs a Keeper no test server has.
 */
export async function startMigratedClickHouse(): Promise<MigratedClickHouse> {
  if (endpoint) return endpoint;

  const [provisioned] = await startTestClickHouseEndpoints({
    suite: MIGRATED_ENDPOINT_SUITE,
    names: ["schema"],
  });
  if (!provisioned) throw new Error("No ClickHouse endpoint was provisioned for the schema suite");

  if (!migratedUrls.has(provisioned.url)) {
    const previousCluster = process.env.CLICKHOUSE_CLUSTER;
    delete process.env.CLICKHOUSE_CLUSTER;
    try {
      await ClickHouseMigrateTask.createFromConfig({
        config: {
          buildTime: false,
          skipped: false,
          sharedUrl: provisioned.url,
          privateEndpoints: [],
        },
      }).execute();
    } finally {
      if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
    }
    migratedUrls.add(provisioned.url);
  }

  endpoint = {
    client: createClient({
      url: provisioned.url,
      clickhouse_settings: {
        ...DEFAULT_CLICKHOUSE_SETTINGS,
        date_time_input_format: "best_effort",
      },
    }),
    url: provisioned.url,
    database: provisioned.database,
  };
  return endpoint;
}

/**
 * Deletes one tenant's rows from the migrated tables.
 *
 * Mutations rather than a dropped database: the endpoint is shared, and the
 * suites key their rows on ids unique per run.
 */
export async function deleteMigratedTenantRows({
  client,
  tenantId,
  tables,
}: {
  client: ClickHouseClient;
  tenantId: string;
  tables: readonly string[];
}): Promise<void> {
  for (const table of tables) {
    await client.command({
      query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
}

interface SeedSpansOptions {
  /** Tenant the rows belong to. */
  tenantId: string;
  /** Total spans to insert, spread over `traceCount` traces. */
  count: number;
  /** Keys per `SpanAttributes` map. */
  attributeKeys: number;
  /** Bytes per attribute value. */
  attributeValueSize?: number;
  traceCount: number;
  /** `TotalCost` per trace, when a case asserts the summed value. */
  knownCost?: number;
}

function generateAttributes(keyCount: number, valueSize: number): Record<string, string> {
  const attributes: Record<string, string> = {};
  const padding = "x".repeat(Math.max(0, valueSize - 10));
  for (let index = 0; index < keyCount; index++) {
    attributes[`attr_key_${index}`] = `val_${index}_${padding}`;
  }
  return attributes;
}

/**
 * Seeds `trace_summaries` and `stored_spans` at a chosen attribute width.
 *
 * The width is the point: an unnecessary `SpanAttributes` read only shows up
 * as a memory failure once the column is genuinely wide.
 */
export async function seedSpans(
  client: ClickHouseClient,
  {
    tenantId,
    count,
    attributeKeys,
    attributeValueSize = 100,
    traceCount,
    knownCost,
  }: SeedSpansOptions,
): Promise<void> {
  const now = Date.now();
  const traceIds = Array.from({ length: traceCount }, (_, index) => `${tenantId}-trace-${index}`);

  const baseSpansPerTrace = Math.floor(count / traceCount);
  const remainder = count % traceCount;
  const spansAllocation = traceIds.map((_, index) =>
    index < remainder ? baseSpansPerTrace + 1 : baseSpansPerTrace,
  );

  const traceSummaryRows = traceIds.map((traceId, index) => ({
    ProjectionId: `${tenantId}-projection-${index}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {
      "langwatch.user_id": `user-${index % 10}`,
      "gen_ai.conversation.id": `thread-${index % 50}`,
      "metadata.env": "test",
    },
    OccurredAt: new Date(now - index * 1000),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    ComputedIOSchemaVersion: "",
    ComputedInput: "test input",
    ComputedOutput: "test output",
    TimeToFirstTokenMs: 50,
    TimeToLastTokenMs: 200,
    TotalDurationMs: 200,
    TokensPerSecond: 100,
    SpanCount: spansAllocation[index] ?? 0,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    ErrorMessage: null,
    Models: ["gpt-5-mini"],
    TotalCost: knownCost ?? 0.01,
    TokensEstimated: false,
    TotalPromptTokenCount: 100,
    TotalCompletionTokenCount: 50,
    OutputFromRootSpan: 0,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: 0,
    TopicId: `topic-${index % 5}`,
    SubTopicId: `subtopic-${index % 10}`,
    HasAnnotation: null,
  }));

  const spanAttributes = generateAttributes(attributeKeys, attributeValueSize);
  spanAttributes["langwatch.span.type"] = "llm";

  const spanRows: Array<Record<string, unknown>> = [];
  let spanIndex = 0;
  for (let trace = 0; trace < traceCount; trace++) {
    const traceId = traceIds[trace];
    const spansForThisTrace = spansAllocation[trace] ?? 0;
    if (traceId === undefined || spansForThisTrace <= 0) continue;
    for (let span = 0; span < spansForThisTrace; span++) {
      spanRows.push({
        ProjectionId: `${tenantId}-span-projection-${spanIndex}`,
        TenantId: tenantId,
        TraceId: traceId,
        SpanId: `span-${spanIndex}`,
        ParentSpanId: null,
        ParentTraceId: null,
        ParentIsRemote: null,
        Sampled: 1,
        StartTime: new Date(now - trace * 1000),
        EndTime: new Date(now - trace * 1000 + 200),
        DurationMs: 200,
        SpanName: "test-span",
        SpanKind: 1,
        ServiceName: "test-service",
        ResourceAttributes: {},
        SpanAttributes: spanAttributes,
        StatusCode: 1,
        StatusMessage: "",
        ScopeName: "",
        ScopeVersion: null,
        "Events.Timestamp": [],
        "Events.Name": [],
        "Events.Attributes": [],
        "Links.TraceId": [],
        "Links.SpanId": [],
        "Links.Attributes": [],
        DroppedAttributesCount: 0,
        DroppedEventsCount: 0,
        DroppedLinksCount: 0,
      });
      spanIndex++;
    }
  }

  await insertInBatches({ client, table: "trace_summaries", rows: traceSummaryRows });
  await insertInBatches({
    client,
    table: "stored_spans",
    rows: spanRows,
    batchSize: batchSizeForRowWidth(attributeKeys * attributeValueSize),
  });
}

const MAX_INSERT_BATCH_ROWS = 1000;

/**
 * Rows per insert, from the width of one row.
 *
 * An insert block is held whole, and the test server has a 1 GiB ceiling:
 * sizing the batch by width keeps the block near 8 MB whatever a case seeds.
 */
function batchSizeForRowWidth(attributeBytes: number): number {
  const approximateRowBytes = attributeBytes + 500;
  return Math.max(1, Math.min(MAX_INSERT_BATCH_ROWS, Math.floor(8_000_000 / approximateRowBytes)));
}

async function insertInBatches({
  client,
  table,
  rows,
  batchSize = MAX_INSERT_BATCH_ROWS,
}: {
  client: ClickHouseClient;
  table: string;
  rows: Array<Record<string, unknown>>;
  batchSize?: number;
}): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    await client.insert({
      table,
      values: rows.slice(offset, offset + batchSize),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }
}

/**
 * Releases the caches the shared endpoint has accumulated.
 *
 * Every suite in the lane shares one 1 GiB server, so a wide seed can be
 * refused for memory an earlier file left behind. This makes its budget its own.
 */
export async function releaseMigratedCaches(client: ClickHouseClient): Promise<void> {
  for (const cache of ["MARK CACHE", "UNCOMPRESSED CACHE", "COMPILED EXPRESSION CACHE"]) {
    await client.command({ query: `SYSTEM DROP ${cache}` });
  }
}
