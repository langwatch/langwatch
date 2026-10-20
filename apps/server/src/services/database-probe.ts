import net from "node:net";
import tls from "node:tls";

import pg from "pg";

import type { DatabaseId } from "../shared/databases.ts";

const PROBE_TIMEOUT_MS = 5_000;

export type ProbeResult = { ok: true } | { ok: false; reason: string };

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Postgres: a real connection and one query, so a wrong password or database name shows here. */
async function probePostgres(url: string): Promise<ProbeResult> {
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: PROBE_TIMEOUT_MS,
  });
  try {
    await client.connect();
    await client.query("select 1");
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

const REDIS_DEFAULT_PORT = 6379;

/** One command in Redis' wire format (RESP): an array of bulk strings. */
function respCommand(args: string[]): string {
  const parts = args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`);
  return `*${args.length}\r\n${parts.join("")}`;
}

/** AUTH with the URL's password (and user, when it names one), then PING. */
function redisCommands(target: URL): string[][] {
  const user = decodeURIComponent(target.username);
  const password = decodeURIComponent(target.password);
  if (password === "") return [["PING"]];
  const auth = user === "" ? ["AUTH", password] : ["AUTH", user, password];
  return [auth, ["PING"]];
}

function openRedisSocket(target: URL): net.Socket {
  const host = target.hostname.replace(/^\[(.*)\]$/, "$1");
  const port = Number(target.port || REDIS_DEFAULT_PORT);
  return target.protocol === "rediss:"
    ? tls.connect({ host, port, servername: net.isIP(host) === 0 ? host : undefined })
    : net.connect({ host, port });
}

/** Sends the commands at once and resolves with one reply line per command. */
function redisExchange({
  target,
  commands,
}: {
  target: URL;
  commands: string[][];
}): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = openRedisSocket(target);
    let received = "";
    const finish = (settle: () => void) => {
      socket.destroy();
      settle();
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () =>
      finish(() => reject(new Error(`no answer within ${PROBE_TIMEOUT_MS / 1000}s`))),
    );
    socket.on("error", (error) => finish(() => reject(error)));
    socket.once(target.protocol === "rediss:" ? "secureConnect" : "connect", () =>
      socket.write(commands.map((command) => respCommand(command)).join("")),
    );
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString("utf8");
      const lines = received.split("\r\n").slice(0, -1);
      if (lines.length >= commands.length) finish(() => resolve(lines));
    });
  });
}

/** Redis: PING, answered PONG; the URL's password is sent first when it has one. */
async function probeRedis(url: string): Promise<ProbeResult> {
  try {
    const target = new URL(url);
    const replies = await redisExchange({ target, commands: redisCommands(target) });
    const refusal = replies.find((reply) => reply.startsWith("-"));
    if (refusal !== undefined) return { ok: false, reason: refusal.slice(1) };
    const pong = replies.at(-1) ?? "";
    return pong === "+PONG" ? { ok: true } : { ok: false, reason: `PING answered ${pong}` };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}

/** ClickHouse: its HTTP /ping, answered "Ok.". */
async function probeClickhouse(url: string): Promise<ProbeResult> {
  try {
    const response = await fetch(new URL("/ping", url), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = (await response.text()).trim();
    return body === "Ok." ? { ok: true } : { ok: false, reason: `/ping answered ${body}` };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}

/** Connects to a database the person brings, before its URL is saved. */
export function probeDatabase({ id, url }: { id: DatabaseId; url: string }): Promise<ProbeResult> {
  switch (id) {
    case "postgres":
      return probePostgres(url);
    case "redis":
      return probeRedis(url);
    case "clickhouse":
      return probeClickhouse(url);
  }
}
