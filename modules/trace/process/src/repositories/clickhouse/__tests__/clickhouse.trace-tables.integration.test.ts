/**
 * ADR-202, "Tables are typed descriptors": every column trace's descriptors declare exists on the
 * migrated schema with the type it is declared as, so a descriptor cannot drift from goose.
 */
import type { ClickHouseTableFacts } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { evaluationRuns } from "../clickhouse.evaluation-runs.table.ts";
import { instantEvalJudgments } from "../clickhouse.instant-eval-judgments.table.ts";
import { instantEvalRuns } from "../clickhouse.instant-eval-runs.table.ts";
import { logRecords } from "../clickhouse.log-records.table.ts";
import { simulationRuns } from "../clickhouse.simulation-runs.table.ts";
import { spanAnalytics } from "../clickhouse.span-analytics.table.ts";
import { storedLogRecords } from "../clickhouse.stored-log-records.table.ts";
import { storedSpans } from "../clickhouse.stored-spans.table.ts";
import { traceAnalyticsRollup } from "../clickhouse.trace-analytics-rollup.table.ts";
import { traceAnalytics } from "../clickhouse.trace-analytics.table.ts";
import { traceEvaluationAnalytics } from "../clickhouse.trace-evaluation-analytics.table.ts";
import { traceSummaries } from "../clickhouse.trace-summaries.table.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const DESCRIPTORS: readonly { readonly $table: ClickHouseTableFacts }[] = [
  storedSpans,
  traceSummaries,
  traceAnalytics,
  traceEvaluationAnalytics,
  traceAnalyticsRollup,
  spanAnalytics,
  // Declared shares (clickhouse-table-ownership.ts): only the columns trace reads.
  evaluationRuns,
  logRecords,
  instantEvalRuns,
  // Named exceptions: the side tables the scenario and Instant Eval filters read.
  simulationRuns,
  instantEvalJudgments,
  // A legacy table trace reads as a fallback (clickhouse-table-ownership.ts records).
  storedLogRecords,
];

/**
 * The parameter type a stored column binds as: storage wrappers that change no value go, a time
 * (an array's members too) binds as epoch milliseconds, and a FixedString binds as String.
 */
const bindingOf = (type: string): string =>
  type
    .replace(/^SimpleAggregateFunction\(\w+, (.+)\)$/, "$1")
    .replaceAll(/LowCardinality\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replaceAll(/Nullable\(([^()]*(?:\([^()]*\))?)\)/g, "$1")
    .replaceAll(/DateTime64\(\d\)/g, "Int64")
    .replace(/^FixedString\(\d+\)$/, "String");

describe.skipIf(!clickHouseConfigured)("trace's descriptors against the migrated schema", () => {
  it.each(DESCRIPTORS.map((table) => [table.$table.stored, table] as const))(
    "declares only %s columns the schema has, binding as their stored types",
    async (name, table) => {
      const client = await startMigratedTraceClickHouse();
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
    },
  );
});
