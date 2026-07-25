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
import {
  ClickHouseContainer,
  type StartedClickHouseContainer,
} from "@testcontainers/clickhouse";

/**
 * The ClickHouse image every container-backed test starts, here and in
 * globalSetup.ts. One symbol rather than one string per call site, so a version
 * bump cannot leave half the suite on the old image.
 */
export const TEST_CLICKHOUSE_IMAGE = "clickhouse/clickhouse-server:25.10.2.65";

export interface TestClickHouseEndpoint {
  /** Connection URL, with this endpoint's own database in the path. */
  url: string;
  /** The database this endpoint owns, for statements that qualify a table. */
  database: string;
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
    names.map(
      async (name): Promise<[string, StartedClickHouseContainer]> => [
        name,
        await new ClickHouseContainer(TEST_CLICKHOUSE_IMAGE)
          .withLabels({
            "langwatch.test": "true",
            [`langwatch.test.${suite}`]: name,
          })
          .withReuse()
          .withStartupTimeout(120_000)
          .start(),
      ],
    ),
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
function databaseName({
  suite,
  name,
}: {
  suite: string;
  name: string;
}): string {
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
