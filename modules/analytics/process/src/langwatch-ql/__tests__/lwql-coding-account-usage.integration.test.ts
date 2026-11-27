/**
 * @vitest-environment node
 * A dashboard widget's query over the account columns of `coding_session_events`: tokens and
 * the newest usage figure per subscription account over the last 7 days, on a real ClickHouse.
 * A table shaped as the catalogue's view stands in for it.
 * @see specs/coding-agent/account-usage.feature
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";

const url =
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL;
const DATABASE = `lwql_coding_accounts_${process.pid}`;
const DAY = 86_400_000;
const PERIOD_END = Math.floor(Date.now() / DAY) * DAY + DAY;
const PERIOD_START = PERIOD_END - 7 * DAY;
const ACCOUNT_ONE = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
const ACCOUNT_TWO = "c0ffee00000040008000000000000001";

const at = (time: number) => new Date(time).toISOString().slice(0, 23).replace("T", " ");
const PARAMETERS = {
  dashboard_context_period_start: at(PERIOD_START).slice(0, 19),
  dashboard_context_period_end: at(PERIOD_END).slice(0, 19),
};

/** The widget query the usage-analytics docs show, as a dashboard binds it. */
const ACCOUNT_WEEK_QUERY = `
  SELECT
    AccountId,
    argMaxIf(AccountName, TimeUnixMs, AccountName != '') AS AccountName,
    sumIf(InputTokens + OutputTokens + CacheReadTokens + CacheCreationTokens, EventKind = 'model_call') AS Tokens,
    countIf(EventKind = 'rate_limit') AS RateLimits,
    argMaxIf(AccountUsagePercent, TimeUnixMs, AccountUsagePercent IS NOT NULL) AS UsagePercent
  FROM coding_session_events
  WHERE TimeUnixMs >= {dashboard_context_period_start:DateTime}
    AND TimeUnixMs < {dashboard_context_period_end:DateTime}
    AND AccountId != ''
  GROUP BY AccountId
  ORDER BY AccountName
`;

type Seed = {
  record: string;
  account: string;
  name: string;
  /** Days before the period end; 8 is outside the week. */
  daysAgo: number;
  kind: "model_call" | "rate_limit";
  tokens: number;
  percent: number | null;
};

const SEEDS: Seed[] = [
  {
    record: "a",
    account: ACCOUNT_ONE,
    name: "",
    daysAgo: 3,
    kind: "model_call",
    tokens: 100,
    percent: 40,
  },
  {
    record: "b",
    account: ACCOUNT_ONE,
    name: "ACME Max 1",
    daysAgo: 1,
    kind: "model_call",
    tokens: 50,
    percent: 72,
  },
  {
    record: "c",
    account: ACCOUNT_ONE,
    name: "ACME Max 1",
    daysAgo: 1,
    kind: "rate_limit",
    tokens: 0,
    percent: null,
  },
  {
    record: "d",
    account: ACCOUNT_ONE,
    name: "Old name",
    daysAgo: 8,
    kind: "model_call",
    tokens: 9000,
    percent: 99,
  },
  {
    record: "e",
    account: ACCOUNT_TWO,
    name: "ACME Max 2",
    daysAgo: 2,
    kind: "model_call",
    tokens: 10,
    percent: null,
  },
  {
    record: "f",
    account: "",
    name: "",
    daysAgo: 1,
    kind: "model_call",
    tokens: 777,
    percent: null,
  },
];

function eventRow(seed: Seed): Record<string, unknown> {
  return {
    TenantId: "project_coding_accounts",
    SessionId: `session-${seed.record}`,
    TimeUnixMs: at(PERIOD_END - seed.daysAgo * DAY - 60_000),
    RecordId: seed.record.padEnd(64, "0"),
    EventKind: seed.kind,
    Agent: "claude_code",
    Model: seed.kind === "model_call" ? "claude-opus-5-5" : "",
    InputTokens: seed.tokens,
    AccountId: seed.account,
    AccountName: seed.name,
    AccountUsagePercent: seed.percent,
  };
}

describe.skipIf(!url)("given coding agent calls on two subscription accounts", () => {
  let admin: ClickHouseClient;
  let client: ClickHouseClient;

  beforeAll(async () => {
    admin = createClient({ url });
    await admin.command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` });
    await admin.command({ query: `CREATE DATABASE ${DATABASE}` });
    const onDatabase = new URL(String(url));
    onDatabase.pathname = `/${DATABASE}`;
    client = createClient({ url: onDatabase.toString() });

    const view = LWQL_VIEW_CATALOG.find((candidate) => candidate.name === "coding_session_events");
    if (!view) throw new Error('the catalogue lacks "coding_session_events"');
    const columns = view.columns.map((column) => `\`${column.name}\` ${column.type}`);
    await client.command({
      query: `CREATE TABLE ${DATABASE}.coding_session_events (${columns.join(", ")}) ENGINE = Memory`,
    });
    await client.insert({
      table: `${DATABASE}.coding_session_events`,
      values: SEEDS.map(eventRow),
      format: "JSONEachRow",
    });
  });

  afterAll(async () => {
    await admin?.command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` });
    await client?.close();
    await admin?.close();
  });

  /** @scenario "A dashboard widget groups the last 7 days by account" */
  it("sums each account's tokens over the week and keeps its newest name and usage figure", async () => {
    const result = await client.query({
      query: ACCOUNT_WEEK_QUERY,
      query_params: PARAMETERS,
      format: "JSONEachRow",
    });
    const rows = await result.json<Record<string, unknown>>();

    expect(
      rows.map((row) => ({
        account: row.AccountId,
        name: row.AccountName,
        tokens: Number(row.Tokens),
        rateLimits: Number(row.RateLimits),
        percent: row.UsagePercent,
      })),
    ).toEqual([
      { account: ACCOUNT_ONE, name: "ACME Max 1", tokens: 150, rateLimits: 1, percent: 72 },
      { account: ACCOUNT_TWO, name: "ACME Max 2", tokens: 10, rateLimits: 0, percent: null },
    ]);
  });
});
