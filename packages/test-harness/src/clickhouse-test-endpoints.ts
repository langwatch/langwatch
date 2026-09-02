/**
 * Isolated ClickHouse endpoints for suites that assert per-organization
 * ClickHouse routing.
 *
 * Those suites need two or more endpoints whose data cannot leak into one
 * another, so they can prove that a row written for a private-ClickHouse org
 * lands on that org's endpoint and nowhere else. Two backends provide that:
 *
 *   - Native: one database per endpoint on the always-on local ClickHouse
 *     (LANGWATCH_TEST_CLICKHOUSE_URL), so a laptop runs the suite with no
 *     docker at all. Isolation is by database, the same shape haven gives each
 *     worktree, and it exercises exactly what the suites assert: a distinct URL
 *     resolves to a distinct client that cannot see the other's rows.
 *   - Containers: one ClickHouse container per endpoint. Used in CI, and
 *     locally whenever the native server is not configured.
 *
 * Databases and tables are created if absent and never dropped. The suites key
 * their rows on ids that are unique per run, so leftovers are invisible to
 * them, and leaving the schema in place keeps concurrent runs from pulling it
 * out from under each other.
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
 * Low-footprint tuning copied into every test container's config.d — the same
 * shape haven applies to the ClickHouse it manages (tools/thuishaven/
 * domain/clickhouse.go): a hard memory ceiling, the optional caches zeroed,
 * background pools sized for a container that serves one test run instead of a
 * dedicated server, and the noisy self-telemetry tables off. A stock container
 * idles at whole cores writing metric logs and scheduling merges it will never
 * need. `system.query_log` stays on — trace-list's ClickHouse repository
 * integration test asserts against it. The 1 GiB memory ceiling is a backstop
 * against a runaway query, comfortably above any suite's working set; the idle
 * win comes from the caches, logs and pools, not the cap.
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
 * Label stamped on every tuned test container. Reuse (`withReuse`) matches an
 * existing container by hashing its create options, and copied file content is
 * applied after create — outside the hash — so without a discriminator a
 * pre-tuning container would be reused as-is and silently never get the
 * tuning. Labels are part of the create options, so bumping this value forces
 * new containers whenever the tuning content changes.
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
 * A random organization id for a suite that routes it with a
 * `CLICKHOUSE_URL__<label>__<orgId>` variable.
 *
 * The id lands inside the variable NAME, where `__` separates the label from
 * the organization and the organization is read as the last such segment. Plain
 * `nanoid` draws from an alphabet that contains `_`, so about one id in 800
 * carries a `__` of its own; the name then splits in the wrong place, the route
 * registers under a fragment of the id, and the organization silently falls
 * back to the shared client. The alphabet here has no `_`, so the name a suite
 * writes is the name the parser reads back.
 *
 * `name` is held to the same rule, and refused rather than repaired: a suite
 * that asks for a namespace the variable cannot carry has a mistake to fix in
 * the line it wrote, and a quietly rewritten namespace would hide it.
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
 * The always-on local ClickHouse that the docker-free test mode runs against,
 * or null when the caller should fall back to containers.
 *
 * The single place that decides whether the native mode is on: globalSetup.ts
 * reads it too, so the two can never disagree about which backend a run uses.
 * Never active in CI, where the service containers are the point.
 */
export function nativeClickHouseBaseUrl(): string | null {
  if (process.env.CI) return null;
  return process.env.LANGWATCH_TEST_CLICKHOUSE_URL ?? null;
}

/**
 * Provisions one isolated endpoint per entry in `names`.
 *
 * `suite` and the names together form each database name, so two suites asking
 * for a "shared" endpoint get different databases and cannot collide.
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
    ? await startNativeEndpoints({ suite, names, baseUrl })
    : await startContainerEndpoints({ suite, names });
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
 * One reusable container per endpoint, each labelled so `docker ps` and the
 * cleanup command in globalSetup.ts can find them. Reuse is keyed on the
 * container's own configuration, so the distinct labels are what keep the
 * endpoints on separate servers rather than collapsing into one.
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
 *
 * `CREATE DATABASE` goes to the server root rather than the endpoint URL: the
 * database does not exist yet, and connecting to a missing one fails before the
 * statement is ever sent.
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
