import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver } from "@langwatch/clickhouse-client";

import { type ClientScript, scriptedClient } from "./scripted-client.ts";

const neverRuns = () => Promise.reject(new Error("the ClickHouse double never runs a statement"));

const silentDriver: QueryDriver = { execute: neverRuns, insert: neverRuns, command: neverRuns };

/** The process's ClickHouseQueryClient, answering only what the test scripted. */
export function clickHouseQueryClientDouble(
  script: ClientScript<ClickHouseQueryClient> = {},
): ClickHouseQueryClient {
  const client = new ClickHouseQueryClient({ driver: silentDriver });
  return scriptedClient({ client, script, name: "clickhouse" });
}

/** The vendor ClickHouseClient, never connected, answering only what the test scripted. */
export function clickHouseClientDouble(
  script: ClientScript<ClickHouseClient> = {},
): ClickHouseClient {
  const client = createClient({ url: "http://clickhouse-double.invalid:8123" });
  return scriptedClient({ client, script, name: "clickhouse" });
}
