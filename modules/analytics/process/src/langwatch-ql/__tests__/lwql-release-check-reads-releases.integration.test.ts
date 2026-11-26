/**
 * @vitest-environment node
 * The Release check finds releases in trace_metrics.AppVersion, the version the trace fold reads
 * from service.version or metadata.version, on a real ClickHouse and within the widget's sources.
 * Tables shaped as the catalogue's views stand in for them.
 * @see specs/lwql/release-check-reads-releases.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";

const url =
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL;
const DATABASE = `lwql_release_check_${process.pid}`;
const VIEWS = ["trace_metrics", "evaluation_metrics", "prompt_versions", "prompts"];
type StockQuery = { label: string; sql: string };

const STOCK = new Map(
  (
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL("./fixtures/stock-widget-queries.json", import.meta.url)),
        "utf8",
      ),
    ) as StockQuery[]
  ).map((query) => [query.label, query.sql]),
);

function stock(label: string): string {
  const sql = STOCK.get(label);
  if (!sql) throw new Error(`no stock query ${label}`);
  return sql;
}

const TENANT = "project_release_check";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PERIOD_END = Math.floor(Date.now() / DAY) * DAY;
const PERIOD_START = PERIOD_END - 30 * DAY;

const at = (time: number) => new Date(time).toISOString().slice(0, 19).replace("T", " ");
const PARAMETERS = {
  dashboard_context_period_start: at(PERIOD_START),
  dashboard_context_period_end: at(PERIOD_END),
  dashboard_context_granularity_seconds: 86_400,
  dashboard_context_timezone: "UTC",
};

type Seed = {
  trace: string;
  /** Hours after the period start; negative is before it. */
  hour: number;
  origin: string;
  version: string;
  model: string;
};

function traceMetricsRow(seed: Seed): Record<string, unknown> {
  const time = at(PERIOD_START + seed.hour * HOUR);
  return {
    TenantId: TENANT,
    TraceId: seed.trace,
    OccurredAt: time,
    UpdatedAt: time,
    TraceName: seed.trace,
    Origin: seed.origin,
    Source: seed.origin || "application",
    Models: [seed.model],
    AppVersion: seed.version,
    TotalCost: 0.01,
    TotalDurationMs: 1000,
    HasError: false,
  };
}

/** One application trace a day on `version` from `fromHour` for `days` days. */
function daily({
  prefix,
  fromHour,
  days,
  version,
}: {
  prefix: string;
  fromHour: number;
  days: number;
  version: string;
}): Seed[] {
  return Array.from({ length: days }, (_, day) => ({
    trace: `${prefix}_${day}`,
    hour: fromHour + day * 24,
    origin: "application",
    version,
    model: "gpt-5-mini",
  }));
}

const V14_HOUR = 10 * 24 + 9;
const V14_1_HOUR = 14 * 24 + 9;

/** v13.2 from before the period, v14 on day 10 and v14.1 on day 14, all on one model. */
const RELEASES: Seed[] = [
  ...daily({ prefix: "v13", fromHour: -5 * 24, days: 15, version: "v13.2" }),
  ...daily({ prefix: "v14", fromHour: V14_HOUR, days: 4, version: "v14" }),
  ...daily({ prefix: "v141", fromHour: V14_1_HOUR, days: 6, version: "v14.1" }),
];

/** Langy's turns: after v14.1, a model and a version the application never used. */
const LANGY: Seed[] = [
  { trace: "langy_0", hour: 2 * 24, origin: "langy", version: "langy-9.8", model: "gemini/x" },
  { trace: "langy_1", hour: 18 * 24, origin: "langy", version: "", model: "gemini/gemini-4-argon" },
  { trace: "langy_2", hour: 19 * 24, origin: "langy", version: "langy-9.9", model: "gemini/x" },
];

describe.skipIf(!url)("given application traces that name their release", () => {
  let admin: ClickHouseClient;
  let client: ClickHouseClient;

  async function rowsOf({
    label,
    list,
  }: {
    label: string;
    list: readonly string[];
  }): Promise<Record<string, unknown>[]> {
    const result = await client.query({
      query: stock(label),
      query_params: { ...PARAMETERS, dashboard_context_sources: list },
      format: "JSONEachRow",
    });
    return result.json<Record<string, unknown>>();
  }

  async function seed(seeds: readonly Seed[]): Promise<void> {
    await client.command({ query: `TRUNCATE TABLE ${DATABASE}.trace_metrics` });
    await client.insert({
      table: `${DATABASE}.trace_metrics`,
      values: seeds.map(traceMetricsRow),
      format: "JSONEachRow",
      clickhouse_settings: { input_format_skip_unknown_fields: 1 },
    });
  }

  const releaseLabels = (rows: Record<string, unknown>[]) =>
    rows
      .map((row) => String(row.label))
      .filter((label) => label.startsWith("Release "))
      .toSorted();

  beforeAll(async () => {
    admin = createClient({ url });
    await admin.command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` });
    await admin.command({ query: `CREATE DATABASE ${DATABASE}` });
    const onDatabase = new URL(String(url));
    onDatabase.pathname = `/${DATABASE}`;
    client = createClient({ url: onDatabase.toString() });

    for (const name of VIEWS) {
      const view = LWQL_VIEW_CATALOG.find((candidate) => candidate.name === name);
      if (!view) throw new Error(`the catalogue lacks "${name}"`);
      const columns = view.columns.map((column) => `\`${column.name}\` ${column.type}`);
      await client.command({
        query: `CREATE TABLE ${DATABASE}.${name} (${columns.join(", ")}) ENGINE = Memory`,
      });
    }
  });

  afterAll(async () => {
    await admin?.command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` });
    await client?.close();
    await admin?.close();
  });

  describe("when the changes query runs under the application list", () => {
    beforeEach(() => seed([...RELEASES, ...LANGY]));

    /** @scenario "Each new version in the period is marked as a release" */
    it("marks v14 and v14.1 at their first traces, and not v13.2", async () => {
      const rows = await rowsOf({ label: "ship-rollout/changes", list: ["application"] });
      const releases = rows.filter((row) => String(row.label).startsWith("Release "));

      expect(releaseLabels(rows)).toEqual(["Release v14", "Release v14.1"]);
      const atOf = (label: string) => releases.find((row) => row.label === label)?.at;
      expect(atOf("Release v14")).toBe(at(PERIOD_START + V14_HOUR * HOUR));
      expect(atOf("Release v14.1")).toBe(at(PERIOD_START + V14_1_HOUR * HOUR));
    });

    it("marks a version that follows the project's first version within hours", async () => {
      await seed([
        ...daily({ prefix: "first", fromHour: 3 * 24, days: 1, version: "v1" }),
        ...daily({ prefix: "hotfix", fromHour: 3 * 24 + 12, days: 3, version: "v1.0.1" }),
      ]);

      const rows = await rowsOf({ label: "ship-rollout/changes", list: ["application"] });
      expect(releaseLabels(rows)).toEqual(["Release v1.0.1"]);
    });

    /** @scenario "A version only Langy's traces carry is not a release of the application" */
    it("lists no release for a version only Langy sent, and lists it under the langy list", async () => {
      const application = await rowsOf({ label: "ship-rollout/changes", list: ["application"] });
      expect(releaseLabels(application)).not.toContain("Release langy-9.9");

      const langy = await rowsOf({ label: "ship-rollout/changes", list: ["langy"] });
      expect(releaseLabels(langy)).toEqual(["Release langy-9.9"]);
    });
  });

  describe("when the Release check's traffic query runs under the application list", () => {
    beforeEach(() => seed([...RELEASES, ...LANGY]));

    /** @scenario "The Release check compares production around the newest release" */
    it("compares the days after v14.1 first appeared with the week before", async () => {
      const rows = await rowsOf({ label: "ship-rollout/traffic", list: ["application"] });
      const side = (after: number) => rows.find((row) => Number(row.after) === after);

      // After v14.1: its 6 daily traces. Before, the 7 days before it: v13.2's last 2 and v14's 4.
      expect(Number(side(1)?.traces)).toBe(6);
      expect(Number(side(0)?.traces)).toBe(6);
    });
  });

  describe("when the traces name no version", () => {
    beforeEach(() =>
      seed([
        ...daily({ prefix: "plain", fromHour: -5 * 24, days: 20, version: "" }),
        { trace: "new_model", hour: 12 * 24, origin: "", version: "", model: "gpt-6-luna" },
      ]),
    );

    /** @scenario "A project whose traces name no version keeps its prompt and model changes" */
    it("lists no release and still lists production's new model", async () => {
      const rows = await rowsOf({ label: "ship-rollout/changes", list: ["application"] });

      expect(releaseLabels(rows)).toEqual([]);
      expect(rows.map((row) => row.label)).toContain("Model: gpt-6-luna");
    });
  });
});
