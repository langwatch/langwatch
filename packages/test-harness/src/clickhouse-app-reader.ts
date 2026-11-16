/**
 * A test ClickHouse holding the app reader as the upgrade provisions it (ADR-202): the statements
 * `@langwatch/clickhouse-migrations` renders, enforcing, and a client per identity over them. The
 * reader's names are server-wide (ADR-202 open question 1), so the shared native server is refused.
 */
import { createHash, randomBytes } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  ClickHouseQueryClient,
  DEFAULT_CLICKHOUSE_SETTINGS,
  type IdIndexDeclaration,
  type QueryDriver,
  TenantGuard,
} from "@langwatch/clickhouse-client";
import {
  migrateTestClickHouseOnce,
  nativeClickHouseBaseUrl,
  startTestClickHouseEndpoints,
  type TestClickHouseEndpoint,
  vendorQueryClient,
  vendorQueryDriver,
} from "@langwatch/clickhouse-client/testing";
import {
  APP_READER_NAMES,
  ClickHouseMigrateTask,
  renderAppReaderDdl,
} from "@langwatch/clickhouse-migrations";

import { holdTestClickHouseServer } from "./clickhouse-server-lock.ts";

export interface TestAppReader {
  /** Every read as the app reader, under its row policies; a reader-only process, as the api. */
  reader: ClickHouseQueryClient;
  /** The system identity: a suite's inserts and commands, and reads no policy binds. */
  system: ClickHouseQueryClient;
  /** As a worker holds it: tenant reads as the reader, inserts and commands as the system. */
  worker: ClickHouseQueryClient;
  /** The system identity's raw connection: a suite's DDL, seed inserts, cleanup and checks. */
  admin: ClickHouseClient;
  /** The reader's raw connection, for a suite that composes its own client around it. */
  readerConnection: ClickHouseClient;
  /** The reader's driver, as `worker` sends its reads through it. */
  readerDriver: QueryDriver;
  /** The reader's own connection URL, for a suite that reads past the client, as a refusal does. */
  readerUrl: string;
  /** Closes every connection and frees the server for the next file; the reader stays. */
  close(): Promise<void>;
}

/** Refuses the shared native server: replacing its reader breaks every suite and stack on it. */
function refuseSharedServer({
  endpoint,
  environment,
}: {
  endpoint: TestClickHouseEndpoint;
  environment: Readonly<Record<string, string | undefined>>;
}): void {
  const native = nativeClickHouseBaseUrl(environment);
  if (native && new URL(native).host === new URL(endpoint.url).host) {
    throw new Error(
      `The app reader "${APP_READER_NAMES.user}" is one user per server, so provisioning it on the shared ClickHouse at ${new URL(native).host} would replace the reader every other suite and the local stack use. Start this suite's endpoint in a container.`,
    );
  }
}

interface AppReaderOptions {
  endpoint: TestClickHouseEndpoint;
  /** The test process's environment, to refuse the shared native server. */
  environment: Readonly<Record<string, string | undefined>>;
  indexes?: readonly IdIndexDeclaration[];
  /** The worker client's system side, for a suite that composes its own; `admin`'s by default. */
  system?: QueryDriver;
  /** Wraps the reader's driver under `worker`, for a suite that counts the reads it sends. */
  wrapReaderDriver?: (driver: QueryDriver) => QueryDriver;
}

/**
 * Provisions the app reader on `endpoint`'s database with the upgrade's own statements, enforcing,
 * and returns a client per identity. Holds the server until `close`: those statements replace the
 * reader, so another file waits rather than breaking this one's reads mid-run.
 */
export async function provisionTestAppReader(options: AppReaderOptions): Promise<TestAppReader> {
  refuseSharedServer(options);
  const release = await holdTestClickHouseServer({ url: options.endpoint.url });
  try {
    return await provisionHeldServer({ ...options, release });
  } catch (error) {
    await release();
    throw error;
  }
}

/** The provisioning itself, on a server this file already holds; `release` frees it on close. */
async function provisionHeldServer({
  endpoint,
  indexes = [],
  system,
  wrapReaderDriver = (driver) => driver,
  release,
}: AppReaderOptions & { release: () => Promise<void> }): Promise<TestAppReader> {
  const password = randomBytes(16).toString("hex");
  const admin = createClient({
    url: endpoint.url,
    clickhouse_settings: { ...DEFAULT_CLICKHOUSE_SETTINGS, date_time_input_format: "best_effort" },
  });
  for (const query of renderAppReaderDdl({
    sourceDatabase: endpoint.database,
    appReader: {
      passwordSha256Hex: createHash("sha256").update(password).digest("hex"),
      enforce: true,
    },
  })) {
    await admin.command({ query });
  }
  const url = new URL(endpoint.url);
  url.username = APP_READER_NAMES.user;
  url.password = password;
  const readerConnection = createClient({ url: url.toString() });
  const readerDriver = vendorQueryDriver({ vendor: readerConnection });
  const reader = new ClickHouseQueryClient({ readerDriver, tenantGuard: new TenantGuard() });
  reader.declareIdIndexes({ indexes });
  const worker = new ClickHouseQueryClient({
    driver: system ?? vendorQueryDriver({ vendor: admin }),
    readerDriver: wrapReaderDriver(readerDriver),
    tenantGuard: new TenantGuard(),
  });
  worker.declareIdIndexes({ indexes });
  return {
    reader,
    system: vendorQueryClient({ vendor: admin, indexes }),
    worker,
    admin,
    readerConnection,
    readerDriver,
    readerUrl: url.toString(),
    async close() {
      try {
        await Promise.all([admin.close(), readerConnection.close()]);
      } finally {
        await release();
      }
    },
  };
}

/**
 * The suite's own container endpoints, never the shared native server: the reader is one user
 * per server. Files naming the same `suite` share each container and database.
 */
export async function startAppReaderEndpoints({
  suite,
  names = ["reader"],
  environment,
}: {
  suite: string;
  names?: string[];
  /** The test process's environment; its shared native server is never used. */
  environment: Readonly<Record<string, string | undefined>>;
}): Promise<TestClickHouseEndpoint[]> {
  const { LANGWATCH_TEST_CLICKHOUSE_URL: _shared, ...containerOnly } = environment;
  const endpoints = await startTestClickHouseEndpoints({
    suite,
    names,
    environment: containerOnly,
  });
  if (endpoints.length !== names.length) {
    throw new Error(`No ClickHouse endpoint was provisioned for ${suite}`);
  }
  return endpoints;
}

/** One container endpoint for `suite`. */
export async function startAppReaderEndpoint({
  suite,
  environment,
}: {
  suite: string;
  environment: Readonly<Record<string, string | undefined>>;
}): Promise<TestClickHouseEndpoint> {
  const [endpoint] = await startAppReaderEndpoints({ suite, environment });
  if (!endpoint) throw new Error(`No ClickHouse endpoint was provisioned for ${suite}`);
  return endpoint;
}

/** The goose-migrated schema on `endpoint`, as the upgrade applies it, once per process. */
export async function migrateAppReaderEndpoint({
  endpoint,
}: {
  endpoint: TestClickHouseEndpoint;
}): Promise<void> {
  await migrateTestClickHouseOnce({
    url: endpoint.url,
    migrate: async () => {
      // No cluster setting: a test server has no Keeper for the Replicated engines.
      await ClickHouseMigrateTask.createFromConfig({
        config: { buildTime: false, sharedUrl: endpoint.url, privateEndpoints: [] },
      }).execute();
    },
  });
}

export interface MigratedAppReaderClickHouse extends TestAppReader {
  endpoint: TestClickHouseEndpoint;
}

const migrated = new Map<string, Promise<MigratedAppReaderClickHouse>>();

/**
 * `suite`'s migrated container with the reader provisioned, opened once per process. Files naming
 * one suite share its container one at a time: each holds the server from its migration until
 * `close` (or its process exits), as `provisionTestAppReader` does.
 */
export function startMigratedAppReaderClickHouse({
  suite,
  indexes = [],
  environment,
}: {
  suite: string;
  indexes?: readonly IdIndexDeclaration[];
  environment: Readonly<Record<string, string | undefined>>;
}): Promise<MigratedAppReaderClickHouse> {
  let opened = migrated.get(suite);
  if (!opened) {
    opened = (async () => {
      const endpoint = await startAppReaderEndpoint({ suite, environment });
      refuseSharedServer({ endpoint, environment });
      const release = await holdTestClickHouseServer({ url: endpoint.url });
      try {
        await migrateAppReaderEndpoint({ endpoint });
        const appReader = await provisionHeldServer({ endpoint, environment, indexes, release });
        const close = async () => {
          migrated.delete(suite);
          await appReader.close();
        };
        return { ...appReader, endpoint, close };
      } catch (error) {
        await release();
        throw error;
      }
    })();
    migrated.set(suite, opened);
  }
  return opened;
}
