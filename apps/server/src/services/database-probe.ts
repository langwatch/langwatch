import net from "node:net";
import tls from "node:tls";

import pg from "pg";

import { redactUrl, type DatabaseId } from "../shared/databases.ts";

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

/** The URL with user and password taken out, and them as a Basic auth header when present. */
function withoutCredentials(url: string): { target: URL; headers: Record<string, string> } {
  const target = new URL(url);
  const user = decodeURIComponent(target.username);
  const password = decodeURIComponent(target.password);
  target.username = "";
  target.password = "";
  if (user === "" && password === "") return { target, headers: {} };
  const token = Buffer.from(`${user}:${password}`).toString("base64");
  return { target, headers: { Authorization: `Basic ${token}` } };
}

/**
 * ClickHouse: `SELECT 1` over HTTP in the URL path's database, answered "1". Not /ping, which
 * checks neither the user and password nor the database. fetch refuses a URL carrying
 * credentials, so they go in a header.
 */
async function probeClickhouse(url: string): Promise<ProbeResult> {
  try {
    const { target, headers } = withoutCredentials(url);
    const database = decodeURIComponent(target.pathname.replace(/^\/+|\/+$/g, ""));
    const query = new URL("/", target);
    if (database !== "") query.searchParams.set("database", database);
    query.searchParams.set("query", "SELECT 1");
    const response = await fetch(query, {
      headers,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = (await response.text()).trim();
    return response.ok && body === "1"
      ? { ok: true }
      : { ok: false, reason: `SELECT 1 answered ${response.status}: ${body}` };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}

function probeOne({ id, url }: { id: DatabaseId; url: string }): Promise<ProbeResult> {
  switch (id) {
    case "postgres":
      return probePostgres(url);
    case "redis":
      return probeRedis(url);
    case "clickhouse":
      return probeClickhouse(url);
  }
}

/** A reason with the URL's password taken out wherever a driver repeated it. */
function redactReason({ reason, url }: { reason: string; url: string }): string {
  if (!URL.canParse(url)) return reason;
  const { password } = new URL(url);
  if (password === "") return reason;
  const withoutUrl = reason.split(url).join(redactUrl(url));
  return [password, decodeURIComponent(password)].reduce(
    (text, secret) => text.split(secret).join("***"),
    withoutUrl,
  );
}

/** Connects to a database the person brings, before it is saved; no reason shows its password. */
export async function probeDatabase({
  id,
  url,
}: {
  id: DatabaseId;
  url: string;
}): Promise<ProbeResult> {
  const result = await probeOne({ id, url });
  return result.ok ? result : { ok: false, reason: redactReason({ reason: result.reason, url }) };
}
