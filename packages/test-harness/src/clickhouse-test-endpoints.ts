/**
 * Isolated endpoints for routing tests: native (databases per endpoint) or
 * containers. Schemas persist across runs.
 */
import { createClient } from "@clickhouse/client";
import { ClickHouseContainer, type StartedClickHouseContainer } from "@testcontainers/clickhouse";
import { customAlphabet } from "nanoid";

/**
 * The ClickHouse image every container-backed test starts, here and in
 * globalSetup.ts. One symbol rather than one string per call site, so a version
 * bump cannot leave half the suite on the old image.
 */
export const TEST_CLICKHOUSE_IMAGE = "clickhouse/clickhouse-server:25.10.2.65";

/**
 * Test container tuning: memory cap, caches off, pools for container. Same
 * as haven applies (tools/thuishaven/domain/clickhouse.go).
 */
export const TEST_CLICKHOUSE_TUNING = {
  target: "/etc/clickhouse-server/config.d/zz-langwatch-test-tuning.xml",
  content: `<clickhouse>
    <max_server_memory_usage>1073741824</max_server_memory_usage>
    <mark_cache_size>67108864</mark_cache_size>
    <uncompressed_cache_size>0</uncompressed_cache_size>
    <mmap_cache_size>0</mmap_cache_size>
    <compiled_expression_cache_size>0</compiled_expression_cache_size>
    <max_concurrent_queries>16</max_concurrent_queries>
    <background_pool_size>4</background_pool_size>
    <background_common_pool_size>2</background_common_pool_size>
    <background_schedule_pool_size>16</background_schedule_pool_size>
    <background_buffer_flush_schedule_pool_size>2</background_buffer_flush_schedule_pool_size>
    <background_fetches_pool_size>2</background_fetches_pool_size>
    <background_move_pool_size>2</background_move_pool_size>
    <background_message_broker_schedule_pool_size>2</background_message_broker_schedule_pool_size>
    <background_distributed_schedule_pool_size>2</background_distributed_schedule_pool_size>
    <merge_tree>
        <number_of_free_entries_in_pool_to_lower_max_size_of_merge>2</number_of_free_entries_in_pool_to_lower_max_size_of_merge>
        <number_of_free_entries_in_pool_to_execute_mutation>2</number_of_free_entries_in_pool_to_execute_mutation>
        <number_of_free_entries_in_pool_to_execute_optimize_entire_partition>2</number_of_free_entries_in_pool_to_execute_optimize_entire_partition>
    </merge_tree>
    <logger>
        <level>warning</level>
    </logger>
    <text_log remove="1"/>
    <trace_log remove="1"/>
    <metric_log remove="1"/>
    <asynchronous_metric_log remove="1"/>
    <processors_profile_log remove="1"/>
    <query_metric_log remove="1"/>
</clickhouse>
`,
} as const;

/**
 * Label stamped on every tuned test container. `withReuse` matches by hashing
 * create options, but copied file content is applied after create — outside
 * the hash — so bumping this value is what forces new containers when tuning changes.
 */
export const TEST_CLICKHOUSE_TUNING_LABEL = {
  "langwatch.test.clickhouse-tuning": "v1",
};

export interface TestClickHouseEndpoint {
  /** Connection URL, with this endpoint's own database in the path. */
  url: string;
  /** The database this endpoint owns, for statements that qualify a table. */
  database: string;
}

/**
 * Random org id with alphabet excluding `_` (parser needs exact name match in
 * env var name).
 */
const routableIdSuffix = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6);

export function privateRouteOrgId(name: string): string {
  if (name.includes("__")) {
    throw new Error(
      `A private-route org id cannot be named "${name}": "__" separates the label from the organization in the env var name, so the parser would read back only what follows it.`,
    );
  }
  return `${name}-${routableIdSuffix()}`;
}

/**
 * The always-on local ClickHouse the docker-free test mode runs against, or
 * null to fall back to containers. The single place that decides whether
 * native mode is on — globalSetup.ts reads it too — and never active in CI.
 */
export function nativeClickHouseBaseUrl(): string | null {
  if (process.env.CI) return null;
  return process.env.LANGWATCH_TEST_CLICKHOUSE_URL ?? null;
}

/**
 * URLs whose schema this process has already migrated: goose is blocking
 * and applies the whole set, so without this a shard's files sharing an
 * endpoint would each re-run migration against an already-migrated database.
 */
const migratedUrls = new Set<string>();

/**
 * Runs `migrate` at most once per ClickHouse URL in this process. A second
 * call for the same URL returns without migrating; a different URL migrates
 * on its own.
 */
export async function migrateTestClickHouseOnce({
  url,
  migrate,
}: {
  url: string;
  migrate: () => Promise<void>;
}): Promise<void> {
  if (migratedUrls.has(url)) return;
  await migrate();
  migratedUrls.add(url);
}

/**
 * Provisions one isolated endpoint per entry in `names`. `suite` and the
 * name together form each database name, so two suites asking for a
 * "shared" endpoint get different databases and cannot collide.
 */
export async function startTestClickHouseEndpoints({
  suite,
  names,
}: {
  suite: string;
  names: string[];
}): Promise<TestClickHouseEndpoint[]> {
  const baseUrl = nativeClickHouseBaseUrl();
  return baseUrl
    ? startNativeEndpoints({ suite, names, baseUrl })
    : startContainerEndpoints({ suite, names });
}

/** One database per endpoint on the shared native server. */
async function startNativeEndpoints({
  suite,
  names,
  baseUrl,
}: {
  suite: string;
  names: string[];
  baseUrl: string;
}): Promise<TestClickHouseEndpoint[]> {
  const endpoints: TestClickHouseEndpoint[] = [];
  for (const name of names) {
    endpoints.push(
      await ensureEndpoint({
        baseUrl,
        database: databaseName({ suite, name }),
      }),
    );
  }
  return endpoints;
}

/**
 * One reusable container per endpoint, labelled so `docker ps` and
 * globalSetup.ts's cleanup can find them. Reuse keys on configuration, so
 * the distinct labels are what keep endpoints from collapsing into one.
 */
async function startContainerEndpoints({
  suite,
  names,
}: {
  suite: string;
  names: string[];
}): Promise<TestClickHouseEndpoint[]> {
  const started = await Promise.all(
    names.map(async (name): Promise<[string, StartedClickHouseContainer]> => [
      name,
      await new ClickHouseContainer(TEST_CLICKHOUSE_IMAGE)
        .withLabels({
          "langwatch.test": "true",
          [`langwatch.test.${suite}`]: name,
          ...TEST_CLICKHOUSE_TUNING_LABEL,
        })
        .withReuse()
        .withCopyContentToContainer([TEST_CLICKHOUSE_TUNING])
        .withStartupTimeout(120_000)
        .start(),
    ]),
  );

  const endpoints: TestClickHouseEndpoint[] = [];
  for (const [name, container] of started) {
    endpoints.push(
      await ensureEndpoint({
        baseUrl: container.getConnectionUrl(),
        database: databaseName({ suite, name }),
      }),
    );
  }
  return endpoints;
}

/**
 * Creates the endpoint's database and returns the URL that selects it.
 * `CREATE DATABASE` goes to the server root, not the endpoint URL — the
 * database doesn't exist yet, so connecting to it first would fail.
 */
async function ensureEndpoint({
  baseUrl,
  database,
}: {
  baseUrl: string;
  database: string;
}): Promise<TestClickHouseEndpoint> {
  const root = createClient({ url: rootUrl(baseUrl) });
  try {
    await root.command({ query: `CREATE DATABASE IF NOT EXISTS ${database}` });
  } finally {
    await root.close();
  }
  return { database, url: endpointUrl(baseUrl, database) };
}

/**
 * ClickHouse identifiers take letters, digits and underscores, while suite and
 * endpoint names read better with dashes. The `test_` prefix marks the database
 * as disposable next to a developer's real `langwatch` one on the same server.
 */
function databaseName({ suite, name }: { suite: string; name: string }): string {
  return `test_${[suite, name].join("_").replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function rootUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = "/";
  return url.toString();
}

function endpointUrl(baseUrl: string, database: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}
