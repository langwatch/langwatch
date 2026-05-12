import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { httpGetCheck, pollUntilHealthy } from "./health.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

const DB_NAME = "langwatch";

export async function startClickhouse(ctx: RuntimeContext, bus: EventBus): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "clickhouse" });
  const start = Date.now();

  const resolvedPath = ctx.predeps.clickhouse?.resolvedPath;
  if (!resolvedPath) throw new Error("clickhouse predep not resolved — run install first");
  const sp = servicePaths(ctx.paths);
  const configFile = join(sp.clickhouseConfigDir, "config.xml");

  // Always regenerate — the config is purely derived from ctx.ports +
  // ctx.paths, both of which can change between runs (auto-port-shift
  // when the default base is already bound, or LANGWATCH_HOME override).
  // Skipping when the file exists baked the FIRST run's ports into the
  // config forever; subsequent ports-shifted runs would try to bind to
  // the stale port and crash with exit 210 (NETWORK_ERROR).
  writeClickhouseConfig(configFile, ctx);

  const handle = supervise({
    spec: {
      name: "clickhouse",
      command: resolvedPath,
      args: ["server", "--config-file", configFile],
      env: process.env,
    },
    paths: sp,
    bus,
  });

  const ready = await pollUntilHealthy({
    check: httpGetCheck(`http://127.0.0.1:${ctx.ports.clickhouseHttp}/ping`, {
      expectBodyContains: "Ok.",
    }),
    timeoutMs: 60_000,
    intervalMs: 500,
  });
  if (!ready.ok) {
    await handle.stop();
    const hint = diagnoseClickhouseFailure(ctx);
    throw new Error(`clickhouse did not become ready: ${ready.reason}${hint ? `\n${hint}` : ""}`);
  }

  await ensureDatabase(ctx);

  bus.emit({ type: "healthy", service: "clickhouse", durationMs: Date.now() - start });
  return handle;
}

async function ensureDatabase(ctx: RuntimeContext): Promise<void> {
  const url = `http://127.0.0.1:${ctx.ports.clickhouseHttp}/?query=` + encodeURIComponent(
    `CREATE DATABASE IF NOT EXISTS ${DB_NAME}`,
  );
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`clickhouse CREATE DATABASE failed: HTTP ${res.status} ${body}`);
  }
}

function writeClickhouseConfig(path: string, ctx: RuntimeContext): void {
  const dataDir = ctx.paths.clickhouseData;
  const logsDir = ctx.paths.logs;
  const tmpDir = join(dataDir, "tmp");
  const userFiles = join(dataDir, "user_files");
  mkdirSync(ctx.paths.clickhouseData, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(userFiles, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(path.replace(/\/[^/]+$/, ""), { recursive: true });

  const xml = `<?xml version="1.0"?>
<clickhouse>
  <listen_host>127.0.0.1</listen_host>
  <http_port>${ctx.ports.clickhouseHttp}</http_port>
  <tcp_port>${ctx.ports.clickhouseNative}</tcp_port>
  <interserver_http_port>0</interserver_http_port>
  <path>${dataDir}/</path>
  <tmp_path>${tmpDir}/</tmp_path>
  <user_files_path>${userFiles}/</user_files_path>
  <logger>
    <level>information</level>
    <log>${logsDir}/clickhouse-server.log</log>
    <errorlog>${logsDir}/clickhouse-server.err.log</errorlog>
    <size>50M</size>
    <count>3</count>
  </logger>
  <users>
    <default>
      <password></password>
      <networks><ip>::1</ip><ip>127.0.0.1</ip></networks>
      <profile>default</profile>
      <quota>default</quota>
      <access_management>1</access_management>
    </default>
  </users>
  <profiles>
    <default>
      <max_memory_usage>2000000000</max_memory_usage>
    </default>
  </profiles>
  <quotas><default/></quotas>
</clickhouse>
`;
  writeFileSync(path, xml);
}

/**
 * Inspect the most recent clickhouse-server.err.log lines for known
 * failure patterns and surface a friendlier hint than the generic
 * "did not become ready" message.
 *
 * The cryptic exit-code-210 ('NETWORK_ERROR') case has bitten dogfood
 * users multiple times — almost always a zombie clickhouse from a
 * previous shell session still holding the port (the pre-flight
 * portsToCheck doesn't always catch tty-detached holders). Surface the
 * exact port + pkill command instead of leaving the user to grep
 * server.err.log themselves.
 */
function diagnoseClickhouseFailure(ctx: RuntimeContext): string | null {
  const errLog = join(ctx.paths.logs, "clickhouse-server.err.log");
  if (!existsSync(errLog)) return null;
  let tail: string;
  try {
    const buf = readFileSync(errLog, "utf8");
    tail = buf.slice(-4000); // last ~50 lines is plenty
  } catch {
    return null;
  }
  const portMatch = tail.match(/Listen \[127\.0\.0\.1\]:(\d+) failed: Address already in use/);
  if (portMatch) {
    const port = portMatch[1];
    return (
      `→ port :${port} is already bound by another process — likely a zombie clickhouse from a previous run.\n` +
      `  Investigate:  lsof -iTCP:${port} -sTCP:LISTEN\n` +
      `  Quick fix:    pkill -f langwatch/bin/clickhouse  # then re-run npx`
    );
  }
  if (/Permission denied/.test(tail)) {
    return `→ permission denied while opening files in ~/.langwatch/data/clickhouse — check directory ownership.`;
  }
  return null;
}
