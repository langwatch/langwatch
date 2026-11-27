/**
 * @vitest-environment node
 * The stock queries that read traffic, tokens, spend and new models keep to the widget's sources
 * on a real ClickHouse: Langy's traces never count as production. Tables shaped as the
 * catalogue's views stand in for them. @see specs/lwql/stock-widgets-keep-to-sources.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";

const url =
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL;
const DATABASE = `lwql_keep_to_sources_${process.pid}`;
/** The views the covered queries read; prompt_versions and prompts stay empty. */
const VIEWS = ["trace_metrics", "prompt_versions", "prompts"];
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

const TENANT = "project_keep_to_sources";
const DAY = 86_400_000;
const PERIOD_END = Math.floor(Date.now() / DAY) * DAY;
const PERIOD_START = PERIOD_END - 7 * DAY;

const at = (time: number) => new Date(time).toISOString().slice(0, 19).replace("T", " ");
const PARAMETERS = {
  dashboard_context_period_start: at(PERIOD_START),
  dashboard_context_period_end: at(PERIOD_END),
  dashboard_context_granularity_seconds: 7 * 86_400,
};

const LANGY_MODEL = "gemini/gemini-4-argon";

type Seed = {
  trace: string;
  /** Days after the period start; negative is before it. */
  day: number;
  origin: string;
  models: string[];
  cost: number;
  promptTokens: number;
};

const SEEDS: Seed[] = [
  {
    trace: "app_old",
    day: -10,
    origin: "application",
    models: ["gpt-5"],
    cost: 1,
    promptTokens: 1,
  },
  {
    trace: "app_1",
    day: 1,
    origin: "application",
    models: ["gpt-5"],
    cost: 0.5,
    promptTokens: 100,
  },
  {
    trace: "app_2",
    day: 3,
    origin: "",
    models: ["gpt-5", "text-embed"],
    cost: 1,
    promptTokens: 200,
  },
  {
    trace: "langy_old",
    day: -5,
    origin: "langy",
    models: ["gemini/gemini-3"],
    cost: 1,
    promptTokens: 1,
  },
  { trace: "langy_1", day: 5, origin: "langy", models: [LANGY_MODEL], cost: 2, promptTokens: 5000 },
];

/** A trace_metrics row; an empty Origin reads as application, as the view's Source has it. */
function traceMetricsRow(seed: Seed): Record<string, unknown> {
  const time = at(PERIOD_START + seed.day * DAY);
  return {
    TenantId: TENANT,
    TraceId: seed.trace,
    OccurredAt: time,
    UpdatedAt: time,
    TraceName: seed.trace,
    Origin: seed.origin,
    Source: seed.origin || "application",
    Models: seed.models,
    TotalCost: seed.cost,
    PromptTokens: seed.promptTokens,
    CompletionTokens: 10,
    TotalDurationMs: 1200,
    HasError: false,
  };
}

describe.skipIf(!url)(
  "given application traces and Langy traces on a model the application never used",
  () => {
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
      await client.insert({
        table: `${DATABASE}.trace_metrics`,
        values: SEEDS.map(traceMetricsRow),
        format: "JSONEachRow",
        clickhouse_settings: { input_format_skip_unknown_fields: 1 },
      });
    });

    afterAll(async () => {
      await admin?.command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` });
      await client?.close();
      await admin?.close();
    });

    describe("when the changes query runs", () => {
      /** @scenario "A model only Langy used is not marked as a change to production" */
      it("lists only production's new model under the application list", async () => {
        const rows = await rowsOf({ label: "up-errors/changes", list: ["application"] });

        expect(rows.map((row) => row.label)).toEqual(["Model: text-embed"]);
      });

      /** @scenario "A model only Langy used is not marked as a change to production" */
      it("lists Langy's new model under the langy list", async () => {
        const rows = await rowsOf({ label: "up-errors/changes", list: ["langy"] });

        expect(rows.map((row) => row.label)).toEqual([`Model: ${LANGY_MODEL}`]);
      });
    });

    /** @scenario "The Release check names production's change, never a model only Langy ran" */
    it("names production's new model as the Release check's change, not Langy's", async () => {
      const rows = await rowsOf({ label: "ship-rollout/changes", list: ["application"] });

      expect(rows.map((row) => row.label)).toEqual(["Model: text-embed"]);
    });

    /** @scenario "The Release check compares production around a change production made" */
    it("compares production around production's newest change, not Langy's", async () => {
      const rows = await rowsOf({ label: "ship-rollout/traffic", list: ["application"] });
      const after = rows.find((row) => Number(row.after) === 1);

      // Langy's model on day 5 would leave no application trace after the change.
      expect(Number(after?.traces)).toBe(1);
    });

    describe("when the spend, traffic and token queries run under the application list", () => {
      /** @scenario "Spend per model, traffic and tokens leave out Langy's traces" */
      it("splits a two-model trace's cost evenly and names no Langy model", async () => {
        for (const label of ["cost-by-model/models", "top-models/modelCosts"]) {
          const rows = await rowsOf({ label, list: ["application"] });
          const costs = Object.fromEntries(rows.map((row) => [row.model, Number(row.cost)]));

          expect(costs, label).toEqual({ "gpt-5": 1, "text-embed": 0.5 });
        }
      });

      /** @scenario "Spend per model, traffic and tokens leave out Langy's traces" */
      it("counts only the application traces' traffic, spend and tokens", async () => {
        const [totals] = await rowsOf({ label: "up-loops/totals", list: ["application"] });
        expect(Number(totals?.traces)).toBe(2);
        expect(Number(totals?.cost)).toBe(1.5);

        const tokens = await rowsOf({ label: "token-drift/main", list: ["application"] });
        const prompt = tokens.reduce((sum, row) => sum + Number(row.prompt_tokens), 0);
        expect(prompt).toBe(300);
      });
    });

    // Runs last: the tied traces it adds would change the other queries' rows.
    describe("when eleven models tie on traces", () => {
      /** @scenario "Top models reads the cost of each model it lists" */
      it("lists the same ten models in the top list and its cost lookup", async () => {
        const tied = Array.from({ length: 11 }, (_, index) => ({
          trace: `tie_${index}`,
          day: 2,
          origin: "application",
          models: [`tie-${String(index).padStart(2, "0")}`],
          cost: 0.25,
          promptTokens: 1,
        }));
        await client.insert({
          table: `${DATABASE}.trace_metrics`,
          values: tied.map(traceMetricsRow),
          format: "JSONEachRow",
          clickhouse_settings: { input_format_skip_unknown_fields: 1 },
        });

        const list = ["application"];
        const listed = await rowsOf({ label: "top-models/models", list });
        const costed = await rowsOf({ label: "top-models/modelCosts", list });
        const names = (rows: Record<string, unknown>[]) =>
          rows.map((row) => String(row.model)).toSorted();

        expect(listed).toHaveLength(10);
        expect(names(costed)).toEqual(names(listed));
      });
    });
  },
);
