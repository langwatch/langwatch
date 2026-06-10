import {
  ClickHouseContainer,
  type StartedClickHouseContainer,
} from "@testcontainers/clickhouse";
import {
  RedisContainer,
  type StartedRedisContainer,
} from "@testcontainers/redis";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";
import { migrateUp } from "~/server/clickhouse/goose";

const TEST_DATABASE = "test_langwatch";

/**
 * Path to the file where container connection info is stored.
 * This file is used to share connection URLs between globalSetup and test workers.
 */
export const CONTAINER_INFO_FILE = path.join(
  os.tmpdir(),
  "langwatch-test-containers.json",
);

/**
 * Common labels for testcontainers to help with cleanup.
 */
const CONTAINER_LABELS = {
  "langwatch.test": "true",
  "langwatch.test.type": "integration",
};

/**
 * XML configuration for ClickHouse storage policy.
 */
const STORAGE_POLICY_CONFIG = `
<clickhouse>
    <storage_configuration>
        <disks>
            <hot>
                <path>/var/lib/clickhouse/hot/</path>
            </hot>
            <cold>
                <path>/var/lib/clickhouse/cold/</path>
            </cold>
        </disks>
        <policies>
            <local_primary>
                <volumes>
                    <hot>
                        <disk>hot</disk>
                    </hot>
                    <cold>
                        <disk>cold</disk>
                    </cold>
                </volumes>
            </local_primary>
        </policies>
    </storage_configuration>
</clickhouse>
`.trim();

/**
 * Creates a temporary storage policy config file for ClickHouse.
 */
function createStoragePolicyConfigFile(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clickhouse-config-"));
  const configPath = path.join(tempDir, "storage_policy.xml");
  fs.writeFileSync(configPath, STORAGE_POLICY_CONFIG);
  return configPath;
}

const MIGRATIONS_HASH_FILE = path.join(
  os.tmpdir(),
  "langwatch-test-migrations-hash.txt",
);

/**
 * Computes a hash of all migration files so we can detect when new
 * migrations are added and need to be applied to the reused container.
 */
function computeMigrationsHash(): string {
  const migrationsDir = path.join(__dirname, "../../../../server/clickhouse/migrations");
  if (!fs.existsSync(migrationsDir)) return "";
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
  const hash = crypto.createHash("md5");
  for (const file of files) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(migrationsDir, file)));
  }
  return hash.digest("hex");
}

function needsMigrationRerun(): boolean {
  const currentHash = computeMigrationsHash();
  if (!currentHash) return false;
  try {
    const savedHash = fs.readFileSync(MIGRATIONS_HASH_FILE, "utf8").trim();
    return savedHash !== currentHash;
  } catch {
    return true; // no saved hash = first run or file deleted
  }
}

function saveMigrationsHash(): void {
  fs.writeFileSync(MIGRATIONS_HASH_FILE, computeMigrationsHash());
}

let clickHouseContainer: StartedClickHouseContainer | null = null;
let redisContainer: StartedRedisContainer | null = null;

type LocalServiceUrls = {
  clickHouseBaseUrl: string;
  redisUrl: string;
  databaseUrl?: string;
};

/**
 * Native local-services mode: run integration tests against always-on local
 * ClickHouse/Redis/Postgres instead of docker testcontainers. Activated by
 * LANGWATCH_TEST_CLICKHOUSE_URL + LANGWATCH_TEST_REDIS_URL (typically set in
 * langwatch/.env, loaded by vitest.integration.config.ts). Each service gets
 * a dedicated test database (test_langwatch on ClickHouse, a numbered redis
 * db, LANGWATCH_TEST_DATABASE_URL's database on Postgres) so suites never
 * touch dev data. Never active in CI.
 */
function localServiceUrls(): LocalServiceUrls | null {
  if (process.env.CI) return null;
  const clickHouseBaseUrl = process.env.LANGWATCH_TEST_CLICKHOUSE_URL;
  const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;
  if (!clickHouseBaseUrl || !redisUrl) return null;
  return {
    clickHouseBaseUrl,
    redisUrl,
    databaseUrl: process.env.LANGWATCH_TEST_DATABASE_URL,
  };
}

async function setupLocalServices(urls: LocalServiceUrls): Promise<void> {
  console.log(
    "[globalSetup] Using native local services (no docker): LANGWATCH_TEST_* env vars are set",
  );

  const redisDb = new URL(urls.redisUrl).pathname.replace(/^\//, "");
  if (!redisDb || redisDb === "0") {
    throw new Error(
      "LANGWATCH_TEST_REDIS_URL must select a numbered redis database (e.g. redis://localhost:6379/5): " +
        "the instance is shared with the dev stack and db 0 holds the dev queues",
    );
  }

  // Always run goose here (no migrations-hash shortcut): the hash file is
  // shared across targets, so switching between docker and native ClickHouse
  // could otherwise skip migrations the new target never received. Goose is
  // a fast no-op when the database is up to date.
  console.log(
    `[globalSetup] Running ClickHouse migrations on ${urls.clickHouseBaseUrl} (database ${TEST_DATABASE})...`,
  );
  await migrateUp({
    connectionUrl: urls.clickHouseBaseUrl,
    database: TEST_DATABASE,
    verbose: false,
  });

  if (urls.databaseUrl) {
    ensureLocalPostgresDatabase(urls.databaseUrl);
    console.log(
      "[globalSetup] Running prisma migrate deploy on the test Postgres database...",
    );
    execSync("pnpm prisma migrate deploy", {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: urls.databaseUrl },
    });
  }

  const clickHouseUrl = new URL(urls.clickHouseBaseUrl);
  clickHouseUrl.pathname = `/${TEST_DATABASE}`;

  const containerInfo = {
    clickHouseUrl: clickHouseUrl.toString(),
    redisUrl: urls.redisUrl,
    ...(urls.databaseUrl ? { databaseUrl: urls.databaseUrl } : {}),
  };
  fs.writeFileSync(CONTAINER_INFO_FILE, JSON.stringify(containerInfo));

  console.log(`[globalSetup] ClickHouse URL: ${containerInfo.clickHouseUrl}`);
  console.log(`[globalSetup] Redis URL: ${containerInfo.redisUrl}`);
  if (urls.databaseUrl) {
    console.log(`[globalSetup] Postgres URL: ${urls.databaseUrl}`);
  }
  console.log(`[globalSetup] Container info written to: ${CONTAINER_INFO_FILE}`);
}

/**
 * Creates the test database on the local Postgres when it doesn't exist yet,
 * via psql against the maintenance database on the same server.
 */
function ensureLocalPostgresDatabase(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  const dbName = url.pathname.replace(/^\//, "");
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(
      `LANGWATCH_TEST_DATABASE_URL must name a [a-zA-Z0-9_]+ database, got "${dbName}"`,
    );
  }
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";

  const exists = execSync(
    `psql "${adminUrl.toString()}" -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'"`,
    { encoding: "utf-8" },
  ).trim();
  if (exists !== "1") {
    console.log(`[globalSetup] Creating Postgres database ${dbName}...`);
    execSync(`psql "${adminUrl.toString()}" -c 'CREATE DATABASE "${dbName}"'`, {
      stdio: "inherit",
    });
  }
}

/**
 * Global setup for integration tests.
 * Starts testcontainers ONCE before all test files run.
 * Connection URLs are written to a temp file for test workers to read.
 */
export async function setup(): Promise<void> {
  // Hard floor: vitest's integration shard 4 of 6 in CI reproducibly wedges
  // after the last test of the last file passes. Every diagnostic we have
  // run (handle dumps, --no-coverage, --no-json-reporter, pool=threads vs
  // pool=forks) shows the worker reaches steady state with no application
  // handles open, then vitest main process sits idle for the full job
  // timeout cap. The wedge appears to be in vitest's own shard / reporter
  // finalize path and we cannot fix it from inside a test. Schedule a hard
  // process.exit(0) so the step at least completes and the rest of the
  // langwatch-app-complete required check unblocks. Unref'd so a healthy
  // shard exits immediately on its own; the timer only fires on the wedge.
  if (process.env.CI) {
    const HARD_FLOOR_MS = 20 * 60 * 1000;
    const timer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.log(
        `[globalSetup] hard floor reached at ${HARD_FLOOR_MS / 60_000} min after start — forcing process.exit(0) to release the CI step from a vitest finalize wedge`,
      );
      process.exit(0);
    }, HARD_FLOOR_MS);
    timer.unref();
  }

  // Generate sdk-versions.json (normally done by start:prepare:files)
  const sdkVersionsPath = path.join(__dirname, "../../../../server/sdk-radar/sdk-versions.json");
  if (!fs.existsSync(sdkVersionsPath)) {
    console.log("[globalSetup] Generating sdk-versions.json...");
    execSync("pnpm run generate:sdk-versions", { stdio: "inherit" });
  }

  // Skip if using CI service containers
  if (process.env.CI_CLICKHOUSE_URL && process.env.CI_REDIS_URL && process.env.CI) {
    console.log("[globalSetup] Using CI service containers");
    return;
  }

  // Skip docker entirely when native local services are configured
  const localServices = localServiceUrls();
  if (localServices) {
    await setupLocalServices(localServices);
    return;
  }

  console.log("[globalSetup] Starting testcontainers...");

  // Start ClickHouse container (reusable to speed up subsequent test runs)
  const storagePolicyConfigPath = createStoragePolicyConfigFile();

  clickHouseContainer = await new ClickHouseContainer("clickhouse/clickhouse-server:25.10.2.65")
    .withLabels(CONTAINER_LABELS)
    .withReuse()
    .withCopyFilesToContainer([
      {
        source: storagePolicyConfigPath,
        target: "/etc/clickhouse-server/config.d/storage.xml",
      },
    ])
    .withStartupTimeout(120000) // 2 minutes for container startup
    .start();

  // Start Redis container (reusable to speed up subsequent test runs)
  redisContainer = await new RedisContainer("redis:alpine")
    .withLabels(CONTAINER_LABELS)
    .withReuse()
    .start();

  const clickHouseBaseUrl = clickHouseContainer.getConnectionUrl();
  const redisUrl = redisContainer.getConnectionUrl();

  // Run goose migrations to create database and tables.
  // With reusable containers, only re-run if migration files changed.
  const migrationsChanged = needsMigrationRerun();
  if (migrationsChanged) {
    console.log("[globalSetup] Migration files changed, running ClickHouse migrations...");
    await migrateUp({
      connectionUrl: clickHouseBaseUrl,
      database: TEST_DATABASE,
      verbose: false,
    });
    saveMigrationsHash();
  } else {
    console.log("[globalSetup] Migration files unchanged, skipping migrations.");
  }

  // Create URL with the correct database name for test workers
  const urlWithDatabase = new URL(clickHouseBaseUrl);
  urlWithDatabase.pathname = `/${TEST_DATABASE}`;
  const clickHouseUrl = urlWithDatabase.toString();

  // Write connection URLs to a temp file for test workers to read
  const containerInfo = {
    clickHouseUrl,
    redisUrl,
  };
  fs.writeFileSync(CONTAINER_INFO_FILE, JSON.stringify(containerInfo));

  console.log(`[globalSetup] ClickHouse URL: ${clickHouseUrl}`);
  console.log(`[globalSetup] Redis URL: ${redisUrl}`);
  console.log(`[globalSetup] Container info written to: ${CONTAINER_INFO_FILE}`);
  console.log("[globalSetup] Testcontainers started successfully");
}

/**
 * Global teardown for integration tests.
 * With reusable containers, we don't stop them - they persist for faster subsequent runs.
 * To manually stop: docker rm -f $(docker ps -q --filter "label=langwatch.test=true")
 */
export async function teardown(): Promise<void> {
  // Skip if using CI service containers
  if (process.env.CI_CLICKHOUSE_URL && process.env.CI_REDIS_URL && process.env.CI) {
    return;
  }

  // Native local services are not ours to stop
  if (localServiceUrls()) {
    return;
  }

  // With reusable containers, we keep them running for faster subsequent test runs.
  // The container info file is also kept so the next run can find the containers.
  // To force cleanup, set STOP_TEST_CONTAINERS=true or run:
  //   docker rm -f $(docker ps -q --filter "label=langwatch.test=true")
  if (process.env.STOP_TEST_CONTAINERS !== "true") {
    console.log("[globalSetup] Keeping reusable containers running for faster subsequent runs");
    return;
  }

  console.log("[globalSetup] Stopping testcontainers...");

  // Clean up the container info file
  try {
    fs.unlinkSync(CONTAINER_INFO_FILE);
  } catch {
    // File might not exist
  }

  if (clickHouseContainer) {
    await clickHouseContainer.stop({ timeout: 10000 });
    clickHouseContainer = null;
  }

  if (redisContainer) {
    await redisContainer.stop({ timeout: 10000 });
    redisContainer = null;
  }

  console.log("[globalSetup] Testcontainers stopped");
}
