/**
 * E2E validation script — queries ClickHouse to confirm that the expected
 * rows from a previous `seed.ts` run + migration invocation are present.
 *
 * Expected state (matches the counts produced by seed.ts with the defaults):
 *   event_log          → TRACE_COUNT trace events + (SIM_COUNT * 3) simulation events
 *   trace_summaries    → TRACE_COUNT rows
 *   stored_spans       → TRACE_COUNT rows
 *   simulation_runs    → SIM_COUNT rows
 *
 * All rows are scoped by TenantId = E2E_TENANT_ID. The script exits with
 * code 1 on any mismatch so CI can fail loudly.
 *
 * Usage:
 *   CLICKHOUSE_URL="http://default:ci_password@localhost:8123/default" \
 *   E2E_TENANT_ID=e2e-test-project \
 *   pnpm tsx test/e2e/validate.ts
 */

import { createClient } from "@clickhouse/client";

const CH_URL =
  process.env.CLICKHOUSE_URL ??
  "http://default:ci_password@localhost:8123/default";
const TENANT_ID = process.env.E2E_TENANT_ID ?? "e2e-test-project";
const TRACE_COUNT = parseInt(process.env.E2E_TRACE_COUNT ?? "5", 10);
const SIM_COUNT = parseInt(process.env.E2E_SIMULATION_COUNT ?? "3", 10);
const EXPECTED_SIM_EVENT_COUNT = SIM_COUNT * 3; // STARTED + MESSAGE_SNAPSHOT + FINISHED

interface Check {
  name: string;
  query: string;
  expected: number;
}

async function main(): Promise<void> {
  const ch = createClient({
    url: new URL(CH_URL),
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });

  const checks: Check[] = [
    {
      name: "event_log traces",
      query: `SELECT count() AS n FROM event_log WHERE TenantId = {tenant:String} AND AggregateType = 'trace'`,
      expected: TRACE_COUNT,
    },
    {
      name: "event_log simulation events",
      query: `SELECT count() AS n FROM event_log WHERE TenantId = {tenant:String} AND AggregateType = 'simulation_run'`,
      expected: EXPECTED_SIM_EVENT_COUNT,
    },
    {
      name: "trace_summaries rows",
      query: `SELECT count() AS n FROM trace_summaries WHERE TenantId = {tenant:String}`,
      expected: TRACE_COUNT,
    },
    {
      name: "stored_spans rows",
      query: `SELECT count() AS n FROM stored_spans WHERE TenantId = {tenant:String}`,
      expected: TRACE_COUNT,
    },
    {
      name: "simulation_runs projections",
      query: `SELECT count(DISTINCT ScenarioRunId) AS n FROM simulation_runs WHERE TenantId = {tenant:String}`,
      expected: SIM_COUNT,
    },
  ];

  let failures = 0;
  for (const check of checks) {
    const result = await ch.query({
      query: check.query,
      query_params: { tenant: TENANT_ID },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ n: string | number }>();
    const actual = Number(rows[0]?.n ?? 0);
    const ok = actual === check.expected;
    const icon = ok ? "PASS" : "FAIL";
    process.stderr.write(
      `[${icon}] ${check.name}: expected=${check.expected} actual=${actual}\n`,
    );
    if (!ok) failures++;
  }

  await ch.close();

  if (failures > 0) {
    process.stderr.write(
      `\n${failures} check(s) failed — migration did not produce expected state.\n`,
    );
    process.exit(1);
  }
  process.stderr.write(
    `\nAll ${checks.length} checks passed. Migration produced expected state for tenant=${TENANT_ID}.\n`,
  );
}

main().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
