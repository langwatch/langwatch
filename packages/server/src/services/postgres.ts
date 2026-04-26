import { execa } from "execa";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { execCheck, pollUntilHealthy } from "./health.ts";
import type { ServicePaths } from "./paths.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

const DB_USER = "langwatch";
const DB_NAME = "langwatch_db";

export type PostgresLayout = {
  postgresBin: string;
  initdb: string;
  pgCtl: string;
  psql: string;
  createdb: string;
};

export function postgresLayout(postgresBinPath: string): PostgresLayout {
  const binDir = dirname(postgresBinPath);
  return {
    postgresBin: postgresBinPath,
    initdb: join(binDir, "initdb"),
    pgCtl: join(binDir, "pg_ctl"),
    psql: join(binDir, "psql"),
    createdb: join(binDir, "createdb"),
  };
}

/**
 * Idempotent. On first run: initdb, then start; subsequently: just start.
 * Database creation (langwatch_db) happens after the server is healthy.
 */
export async function startPostgres(ctx: RuntimeContext, bus: EventBus): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "postgres" });
  const start = Date.now();

  const resolvedPath = ctx.predeps.postgres?.resolvedPath;
  if (!resolvedPath) throw new Error("postgres predep not resolved — run install first");
  const layout = postgresLayout(resolvedPath);
  const dataDir = ctx.paths.postgresData;
  const sp = servicePaths(ctx.paths);

  if (!existsSync(join(dataDir, "PG_VERSION"))) {
    await initdb(layout, dataDir);
  }

  const handle = supervise({
    spec: {
      name: "postgres",
      command: layout.postgresBin,
      args: [
        "-D", dataDir,
        "-p", String(ctx.ports.postgres),
        "-h", "127.0.0.1",
        "-c", "unix_socket_directories=" + dirname(sp.pid("postgres")),
        "-c", "log_destination=stderr",
        "-c", "logging_collector=off",
      ],
      env: process.env,
    },
    paths: sp,
    bus,
  });

  const ready = await pollUntilHealthy({
    check: execCheck(layout.psql.replace(/psql$/, "pg_isready"), [
      "-h", "127.0.0.1",
      "-p", String(ctx.ports.postgres),
      "-U", DB_USER,
      "-d", "postgres",
      "-q",
    ]),
    timeoutMs: 30_000,
  });
  if (!ready.ok) {
    await handle.stop();
    throw new Error(`postgres did not become ready: ${ready.reason}`);
  }

  await ensureDatabase(layout, ctx.ports.postgres);

  bus.emit({ type: "healthy", service: "postgres", durationMs: Date.now() - start });
  return handle;
}

async function initdb(layout: PostgresLayout, dataDir: string): Promise<void> {
  mkdirSync(dataDir, { recursive: true });
  await execa(
    layout.initdb,
    [
      "-D", dataDir,
      "-U", DB_USER,
      "-A", "trust",
      "--no-locale",
      "--encoding=UTF8",
    ],
    { stdio: "ignore" },
  );
}

async function ensureDatabase(layout: PostgresLayout, port: number): Promise<void> {
  const { exitCode } = await execa(
    layout.psql,
    [
      "-h", "127.0.0.1",
      "-p", String(port),
      "-U", DB_USER,
      "-d", "postgres",
      "-tc", `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`,
    ],
    { reject: false },
  );
  if (exitCode !== 0) {
    throw new Error("postgres connect probe failed");
  }
  const probe = await execa(
    layout.psql,
    [
      "-h", "127.0.0.1",
      "-p", String(port),
      "-U", DB_USER,
      "-d", "postgres",
      "-tAc", `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`,
    ],
    { reject: false },
  );
  if (probe.stdout.trim() === "1") return;
  await execa(
    layout.createdb,
    [
      "-h", "127.0.0.1",
      "-p", String(port),
      "-U", DB_USER,
      DB_NAME,
    ],
    { stdio: "ignore" },
  );
}
