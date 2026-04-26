import { mkdirSync, writeFileSync, existsSync } from "node:fs";
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

  if (!existsSync(configFile)) writeClickhouseConfig(configFile, ctx);

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
    throw new Error(`clickhouse did not become ready: ${ready.reason}`);
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
