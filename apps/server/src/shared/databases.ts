import { portBoundEnv } from "./env.ts";
import type { PortAllocation } from "./ports.ts";

/**
 * The three stores an install either runs bundled inside ~/.langwatch or brings itself, with the
 * ports the bundled one holds; the first is the one its URL names.
 */
export const DATABASES = [
  { id: "postgres", label: "Postgres", envKey: "DATABASE_URL", portKeys: ["postgres"] },
  { id: "redis", label: "Redis", envKey: "REDIS_URL", portKeys: ["redis"] },
  {
    id: "clickhouse",
    label: "ClickHouse",
    envKey: "CLICKHOUSE_URL",
    portKeys: ["clickhouseHttp", "clickhouseNative"],
  },
] as const satisfies readonly {
  id: string;
  label: string;
  envKey: string;
  portKeys: readonly (keyof PortAllocation)[];
}[];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type DatabaseId = (typeof DATABASES)[number]["id"];

/** Per database: run it bundled, or connect to the URL of one the person already runs. */
export type DatabaseChoice = Record<DatabaseId, { kind: "bundled" } | { kind: "own"; url: string }>;

/** Bundled when the URL names this machine (localhost, 127.0.0.1 or ::1) on the bundled port. */
function isBundledUrl({ value, port }: { value: string; port: number }): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return LOOPBACK_HOSTS.has(url.hostname) && url.port === String(port);
}

/** The databases this install brings itself, read from its .env: another host or port. */
export function ownDatabases({
  env,
  ports,
}: {
  env: Record<string, string | undefined>;
  ports: PortAllocation;
}): DatabaseId[] {
  return DATABASES.filter(({ envKey, portKeys }) => {
    const value = env[envKey] ?? "";
    return value !== "" && !isBundledUrl({ value, port: ports[portKeys[0]] });
  }).map(({ id }) => id);
}

/** The URL as it may be shown: its password replaced by `***`. */
export function redactUrl(url: string): string {
  if (!URL.canParse(url)) return url;
  const parsed = new URL(url);
  if (parsed.password === "") return url;
  parsed.password = "***";
  return parsed.toString();
}

/** The ports this install holds itself: every allocated one but a brought database's. */
export function portsInUse({
  ports,
  own,
}: {
  ports: PortAllocation;
  own: readonly DatabaseId[];
}): { name: string; port: number }[] {
  const brought = new Set<string>(
    DATABASES.filter(({ id }) => own.includes(id)).flatMap(({ portKeys }) => portKeys),
  );
  return Object.entries(ports)
    .filter(([name]) => name !== "base" && !brought.has(name))
    .map(([name, port]) => ({ name, port }));
}

/** The .env value each database gets for a choice: its own URL, or the bundled one. */
export function databaseEnvValues({
  choice,
  ports,
}: {
  choice: DatabaseChoice;
  ports: PortAllocation;
}): Record<string, string> {
  const scaffolded = portBoundEnv(ports);
  return Object.fromEntries(
    DATABASES.map(({ id, envKey }) => {
      const picked = choice[id];
      return [envKey, picked.kind === "own" ? picked.url : scaffolded[envKey].expected];
    }),
  );
}
