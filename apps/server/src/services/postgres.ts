import { execa } from "execa";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { execCheck, pollUntilHealthy } from "./health.ts";
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

// Embedded postgres tarballs (built by .github/workflows/embedded-binaries-
// publish.yml on a Linux runner) ship with a RUNPATH leaked from the build
// host: /home/runner/work/langwatch/langwatch/postgresql-${ver}/_install/lib.
// On any other host ld.so cannot find libpq.so.5 even though it sits in the
// sibling …/postgres/lib/ dir. We compensate at exec time by injecting
// LD_LIBRARY_PATH (DYLD on macOS) pointing at that lib dir. No-op when the
// lib dir is absent (e.g. when detect() reuses an apt-installed system
// postgres at /usr/lib/postgresql/${major}/bin/). Long-term fix is to
// rebuild the embeds tarball with --with-rpath '$ORIGIN/../lib' or run
// patchelf post-extract — tracked as a follow-up against the embeds
// repo, this is the surgical runtime fix.
function pgEnv(resolvedPath: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const libDir = join(dirname(dirname(resolvedPath)), "lib");
  if (!existsSync(libDir)) return base;
  const var_ = process.platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
  const existing = base[var_];
  return {
    ...base,
    [var_]: existing ? `${libDir}:${existing}` : libDir,
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
  const env = pgEnv(resolvedPath);
  const dataDir = ctx.paths.postgresData;
  const sp = servicePaths(ctx.paths);

  if (!existsSync(join(dataDir, "PG_VERSION"))) {
    await initdb(layout, dataDir, env);
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
      env,
    },
    paths: sp,
    bus,
  });

  const ready = await pollUntilHealthy({
    check: execCheck(
      layout.psql.replace(/psql$/, "pg_isready"),
      ["-h", "127.0.0.1", "-p", String(ctx.ports.postgres), "-U", DB_USER, "-d", "postgres", "-q"],
      { env },
    ),
    timeoutMs: 30_000,
  });
  if (!ready.ok) {
    await handle.stop();
    throw new Error(`postgres did not become ready: ${ready.reason}`);
  }

  await ensureDatabase(layout, ctx.ports.postgres, env);

  bus.emit({ type: "healthy", service: "postgres", durationMs: Date.now() - start });
  return handle;
}

async function initdb(layout: PostgresLayout, dataDir: string, env: NodeJS.ProcessEnv): Promise<void> {
  mkdirSync(dataDir, { recursive: true });
  await execa(
    layout.initdb,
    ["-D", dataDir, "-U", DB_USER, "-A", "trust", "--no-locale", "--encoding=UTF8"],
    { stdio: "ignore", env },
  );
}

async function ensureDatabase(layout: PostgresLayout, port: number, env: NodeJS.ProcessEnv): Promise<void> {
  const probe1 = await execa(
    layout.psql,
    ["-h", "127.0.0.1", "-p", String(port), "-U", DB_USER, "-d", "postgres", "-tc", `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`],
    { reject: false, env },
  );
  if (probe1.exitCode !== 0) {
    throw new Error(`postgres connect probe failed (psql exit ${probe1.exitCode}): ${probe1.stderr || probe1.stdout || "no output"}`);
  }
  const probe = await execa(
    layout.psql,
    ["-h", "127.0.0.1", "-p", String(port), "-U", DB_USER, "-d", "postgres", "-tAc", `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`],
    { reject: false, env },
  );
  if (probe.stdout.trim() === "1") return;
  await execa(
    layout.createdb,
    ["-h", "127.0.0.1", "-p", String(port), "-U", DB_USER, DB_NAME],
    { stdio: "ignore", env },
  );
}
