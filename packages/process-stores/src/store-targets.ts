/**
 * The credential-free targets and the untenanted ClickHouse seam, built from the URLs the
 * stores resolved — so the URLs themselves never leave the construction closure (ADR-132).
 */
import { createClient } from "@clickhouse/client";

import type { ClickHouseConfig, DatabaseConfig } from "./config.ts";
import type { BuiltMember } from "./datastore-members.ts";
import type { ClickHouseAdmin, DatabaseTarget } from "./members.ts";

function parsedUrl(url: string | undefined): URL[] {
  const trimmed = url?.trim();
  if (!trimmed) return [];
  try {
    return [new URL(trimmed)];
  } catch {
    return [];
  }
}

/** Not configured where the URL is absent, unparsable or names no database; never a throw. */
export function buildClickHouseAdmin(
  config: ClickHouseConfig | undefined,
): BuiltMember<ClickHouseAdmin> {
  const [parsed] = parsedUrl(config?.url);
  const database = parsed?.pathname.replace(/^\//, "") ?? "";
  if (!parsed || !database || !config?.url) return { value: { configured: false } };
  const server = new URL(parsed.toString());
  server.username = "";
  server.password = "";
  server.pathname = "/";
  server.search = "";
  const client = createClient({
    url: config.url.trim(),
    ...(config.requestTimeoutMs === undefined ? {} : { request_timeout: config.requestTimeoutMs }),
  });
  return {
    value: {
      configured: true,
      target: { url: server.toString(), database },
      statements: {
        async command(statement) {
          await client.command({ query: statement });
        },
        async rows(sql, params) {
          const result = await client.query({
            query: sql,
            format: "JSONEachRow",
            ...(params ? { query_params: { ...params } } : {}),
          });
          return result.json<Record<string, unknown>>();
        },
        async insert({ table, rows, settings }) {
          await client.insert({
            table,
            values: [...rows],
            format: "JSONEachRow",
            ...(settings ? { clickhouse_settings: { ...settings } } : {}),
          });
        },
      },
    },
    close: () => client.close(),
  };
}

export function buildDatabaseTarget(
  config: DatabaseConfig | undefined,
): BuiltMember<DatabaseTarget> {
  const [parsed] = parsedUrl(config?.url);
  const database = parsed?.pathname.replace(/^\//, "") ?? "";
  if (!parsed?.hostname || !database) return { value: { configured: false } };
  const limit = Number(parsed.searchParams.get("connection_limit"));
  return {
    value: {
      configured: true,
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 5432,
      database,
      schema: parsed.searchParams.get("schema") || "public",
      ...(Number.isInteger(limit) && limit > 0 ? { connectionLimit: limit } : {}),
    },
  };
}
