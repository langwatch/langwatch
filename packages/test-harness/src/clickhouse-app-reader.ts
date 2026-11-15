/**
 * A test ClickHouse holding the app reader as the upgrade provisions it (ADR-202): the statements
 * `@langwatch/clickhouse-migrations` renders, enforcing, and a client per identity over them. The
 * reader's names are server-wide (ADR-202 open question 1), so the shared native server is refused.
 */
import { createHash, randomBytes } from "node:crypto";

import { createClient } from "@clickhouse/client";
import {
  ClickHouseQueryClient,
  type IdIndexDeclaration,
  TenantGuard,
} from "@langwatch/clickhouse-client";
import {
  nativeClickHouseBaseUrl,
  type TestClickHouseEndpoint,
  vendorQueryClient,
  vendorQueryDriver,
} from "@langwatch/clickhouse-client/testing";
import { APP_READER_NAMES, renderAppReaderDdl } from "@langwatch/clickhouse-migrations";

export interface TestAppReader {
  /** Every read as the app reader, under its row policies; a reader-only process, as the api. */
  reader: ClickHouseQueryClient;
  /** The system identity: a suite's inserts and commands, and reads no policy binds. */
  system: ClickHouseQueryClient;
  /** The reader's own connection URL, for a suite that reads past the client, as a refusal does. */
  readerUrl: string;
  /** Closes both connections; the reader stays provisioned for the suite's next run. */
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

/** Provisions the app reader on `endpoint`'s database, enforcing; returns a client per identity. */
export async function provisionTestAppReader({
  endpoint,
  environment,
  indexes = [],
}: {
  endpoint: TestClickHouseEndpoint;
  /** The test process's environment, to refuse the shared native server. */
  environment: Readonly<Record<string, string | undefined>>;
  indexes?: readonly IdIndexDeclaration[];
}): Promise<TestAppReader> {
  refuseSharedServer({ endpoint, environment });
  const password = randomBytes(16).toString("hex");
  const admin = createClient({ url: endpoint.url });
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
  const reader = new ClickHouseQueryClient({
    readerDriver: vendorQueryDriver({ vendor: readerConnection }),
    tenantGuard: new TenantGuard(),
  });
  reader.declareIdIndexes({ indexes });
  return {
    reader,
    system: vendorQueryClient({ vendor: admin, indexes }),
    readerUrl: url.toString(),
    async close() {
      await Promise.all([admin.close(), readerConnection.close()]);
    },
  };
}
