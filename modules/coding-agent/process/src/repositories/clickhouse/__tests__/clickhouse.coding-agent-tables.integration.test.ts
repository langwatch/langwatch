/**
 * ADR-202, "Tables are typed descriptors": every column coding-agent's descriptors declare exists
 * on the migrated schema with the type it is declared as, so a descriptor cannot drift from goose.
 */
import type { ClickHouseTableFacts } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { codingAgentSessionEvents } from "../clickhouse.coding-agent-session-events.table.ts";
import { codingAgentSessionsIdIndex } from "../clickhouse.coding-agent-sessions-id-index.table.ts";
import { codingAgentSessions } from "../clickhouse.coding-agent-sessions.table.ts";
import { codingAgentTraceSessions } from "../clickhouse.coding-agent-trace-sessions.table.ts";
import { sessionMetricSeries } from "../clickhouse.session-metric-series.table.ts";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support.ts";

const DESCRIPTORS: readonly { readonly $table: ClickHouseTableFacts }[] = [
  codingAgentSessionEvents,
  codingAgentSessions,
  codingAgentSessionsIdIndex,
  codingAgentTraceSessions,
  sessionMetricSeries,
];

/**
 * The parameter type a stored column binds as: storage wrappers that change no value go, a time
 * binds as epoch milliseconds, a FixedString binds as String, and a SimpleAggregateFunction
 * binds as the type it aggregates.
 */
const bindingOf = (type: string): string =>
  type
    .replace(/^SimpleAggregateFunction\(\w+, (.+)\)$/, "$1")
    .replaceAll(/LowCardinality\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replaceAll(/Nullable\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replaceAll(/DateTime64\(\d\)/g, "Int64")
    .replace(/^FixedString\(\d+\)$/, "String");

const clickHouseUrl = testClickHouseUrl();

describe.skipIf(clickHouseUrl === null)(
  "coding-agent's descriptors against the migrated schema",
  () => {
    it.each(DESCRIPTORS.map((table) => [table.$table.stored, table] as const))(
      "declares only %s columns the schema has, binding as their stored types",
      async (name, table) => {
        const client = createTestClickHouseClient(clickHouseUrl!);
        const result = await client.query({
          query:
            "SELECT name, type FROM system.columns WHERE database = currentDatabase() AND table = {table:String}",
          query_params: { table: name },
          format: "JSONEachRow",
        });
        const stored = new Map(
          ((await result.json()) as { name: string; type: string }[]).map((each) => [
            each.name,
            bindingOf(each.type),
          ]),
        );
        const declared = Object.fromEntries(
          table.$table.columns.map((each) => {
            const ref = Reflect.get(table, each) as { binding: { paramType: string } };
            return [each, ref.binding.paramType];
          }),
        );

        expect(declared).toEqual(
          Object.fromEntries(table.$table.columns.map((each) => [each, stored.get(each)])),
        );
        await client.close();
      },
    );
  },
);
