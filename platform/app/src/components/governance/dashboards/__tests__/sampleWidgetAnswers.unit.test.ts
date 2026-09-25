/**
 * The invented answers behind the governance dashboard widgets.
 *
 * The four widgets are real dashboard widgets in the product's own format,
 * and their queries name columns the chart code reads by name. Nothing can
 * answer those queries yet — the cost rollup they want is not in the query
 * catalog — so the page hands the chart frame an answer factory instead of a
 * catalog execution. That factory is the thing under test here.
 *
 * Two properties matter and neither is cosmetic. First, an answer whose
 * columns drift from the query's own aliases draws a blank chart that looks
 * like a data problem rather than a mismatch, so the columns are checked
 * exactly, in both directions, against the aliases parsed out of the SQL
 * itself. Second, the factory takes a time frame and nothing else: an answer
 * factory that never receives a project or a tenant cannot reach a row, which
 * is how this page proves it never reads rather than merely asserting it.
 *
 * The expected aliases are written out literally as well as parsed, so a
 * widget quietly renaming a column has to be renamed here too.
 *
 * Spec: specs/governance/governance-dashboards.feature
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  recentMonths,
  SAMPLE_AGENTS,
  SAMPLE_DEPARTMENTS,
} from "~/components/governance/costs/sampleSeries";
import type { TimeFrame } from "~/components/governance/filters/timeControls";

import { GOVERNANCE_WIDGETS } from "../governanceWidgets";
import { createSampleExecuteQuery } from "../sampleWidgetAnswers";

/**
 * The SELECT aliases of a query, in the order the query names them.
 *
 * Only the select list is read — everything from the first `FROM` onwards is
 * a source, not a column — and only an `AS` that ends a select item counts,
 * so a `CAST(x AS String) AS bucket` contributes `bucket` and not `String`.
 */
function selectAliases(sql: string): string[] {
  const selectList = sql.slice(
    sql.search(/\bSELECT\b/i) + "SELECT".length,
    sql.search(/\bFROM\b/i),
  );
  return [
    ...selectList.matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?=,|$)/gi),
  ].map((match) => match[1] ?? "");
}

/**
 * What each query is expected to name, spelled out rather than derived. The
 * parsed check catches an answer drifting from its query; this one catches a
 * query and its answer drifting together away from what the charts read.
 */
const EXPECTED_ALIASES: Record<string, string[]> = {
  provider_day: ["bucket", "provider", "cost_usd"],
  department: ["department", "cost_usd"],
  person: ["person", "cost_usd"],
  model_agent: ["model", "agent", "cost_usd"],
};

const FRAME: TimeFrame = "last_12_months";

/** Every declared query across the four widgets, paired with its SQL. */
const allQueries = () =>
  GOVERNANCE_WIDGETS.flatMap((widget) =>
    widget.definition.queries.map((query) => ({
      widget: widget.name,
      name: query.name,
      sql: query.sql,
    })),
  );

const answer = (queryName: string, frame: TimeFrame = FRAME) =>
  createSampleExecuteQuery({ frame })({
    queryName,
    params: {},
    signal: new AbortController().signal,
  });

const columnValues = (
  result: { rows: readonly Record<string, unknown>[] },
  column: string,
) => result.rows.map((row) => String(row[column]));

/** What the leading row of an answer spends, in US dollars. */
const topCost = (result: { rows: readonly Record<string, unknown>[] }) =>
  Math.max(...result.rows.map((row) => Number(row.cost_usd)));

describe("the sample answers behind the governance widgets", () => {
  describe("given a widget's query asks for a set of columns", () => {
    describe("when the sample answer for it is produced", () => {
      /** @scenario "A sample answer names exactly the columns its query names" */
      it("carries the query's own aliases, in order, and no others", async () => {
        for (const query of allQueries()) {
          const result = await answer(query.name);

          expect(result.columns.map((column) => column.name)).toEqual(
            selectAliases(query.sql),
          );
        }
      });

      /** @scenario "A sample answer names exactly the columns its query names" */
      it("names the columns the charts read, spelled out", async () => {
        for (const query of allQueries()) {
          expect(selectAliases(query.sql)).toEqual(
            EXPECTED_ALIASES[query.name],
          );
          const result = await answer(query.name);

          expect(result.columns.map((column) => column.name)).toEqual(
            EXPECTED_ALIASES[query.name],
          );
        }
      });

      /** @scenario "A sample answer names exactly the columns its query names" */
      it("gives every row a value under every column it names", async () => {
        for (const query of allQueries()) {
          const result = await answer(query.name);
          const names = [...result.columns.map((column) => column.name)].sort();

          // A chart reads a row by column name. A row missing one of them
          // draws a gap that looks like missing spend rather than a missing
          // column, and a row carrying an extra one hides the mismatch.
          expect(result.rows.length).toBeGreaterThan(0);
          for (const row of result.rows) {
            expect(Object.keys(row).sort()).toEqual(names);
          }
        }
      });
    });
  });

  describe("given a widget over a chosen time frame", () => {
    describe("when the sample answer for it is produced", () => {
      /** @scenario "A sample answer spans the time frame in view" */
      it("runs its buckets from the start of the frame to its end", async () => {
        const result = await answer("provider_day", "last_12_months");

        expect([...new Set(columnValues(result, "bucket"))].sort()).toEqual(
          [...recentMonths(12)].sort(),
        );
      });

      /** @scenario "A sample answer spans the time frame in view" */
      it("narrows to the shorter frame rather than drawing a stripe in a wide axis", async () => {
        const result = await answer("provider_day", "last_3_months");

        expect(new Set(columnValues(result, "bucket")).size).toBe(3);
      });
    });
  });

  describe("given the same answer is asked for twice", () => {
    it("invents the same figures both times", async () => {
      for (const query of allQueries()) {
        const first = await answer(query.name);
        const second = await answer(query.name);

        // Re-rolled figures would reshuffle the chart on every render pass
        // and make a server-rendered page disagree with its first paint.
        expect(second.rows).toEqual(first.rows);
      }
    });
  });

  describe("given the section's invented organization", () => {
    it("names only the departments and agents the rest of governance names", async () => {
      const departments = await answer("department");
      const modelAgent = await answer("model_agent");

      // One imaginary organization across the section, not four unrelated
      // ones: a reader moving between governance pages sees the same names.
      for (const value of columnValues(departments, "department")) {
        expect(SAMPLE_DEPARTMENTS as readonly string[]).toContain(value);
      }
      for (const value of columnValues(modelAgent, "agent")) {
        expect(SAMPLE_AGENTS as readonly string[]).toContain(value);
      }
    });
  });

  describe("given the four widgets describe one organization", () => {
    describe("when each is answered over the same twelve-month frame", () => {
      /** @scenario "Every widget invents money on one scale" */
      it("ranks departments and agents on the scale the person chart uses", async () => {
        const person = topCost(await answer("person"));

        // A department panel reading a tenth of the person panel beside it is
        // the incoherence the Costs page was already fixed for: the reader
        // learns the screen does not add up rather than what it spends.
        expect(topCost(await answer("department"))).toBeGreaterThan(person / 2);
        expect(topCost(await answer("model_agent"))).toBeGreaterThan(
          person / 2,
        );
      });
    });

    describe("when the frame is narrowed to a quarter", () => {
      /** @scenario "Every widget invents money on one scale" */
      it("shrinks the ranked figures with the window rather than holding them", async () => {
        const year = topCost(await answer("department", "last_12_months"));
        const quarter = topCost(await answer("department", "last_3_months"));

        // Twelve buckets against three: a ranked total that ignored the frame
        // would draw a year of spend under a quarter's heading.
        expect(year / quarter).toBeCloseTo(4, 1);
      });
    });
  });

  describe("given a query that orders its rows by what they cost", () => {
    describe("when the sample answer for it is produced", () => {
      /** @scenario "A ranked sample answer arrives in the order its query asks for" */
      it("hands the rows over biggest first, the way the query says it will", async () => {
        for (const name of ["department", "person", "model_agent"]) {
          const result = await answer(name);
          const costs = result.rows.map((row) => Number(row.cost_usd));

          // The chart draws the rows in the order it receives them, so an
          // answer in some other order paints a ranked panel unranked — and
          // the query beside it promises ORDER BY cost_usd DESC.
          expect(costs).toEqual([...costs].sort((a, b) => b - a));
        }
      });
    });
  });

  describe("given a query nothing has been written to answer", () => {
    describe("when an answer for it is asked for", () => {
      /** @scenario "A query with no sample answer is refused, not invented" */
      it("refuses, naming the query, rather than inventing one", async () => {
        await expect(answer("nope")).rejects.toThrow(/nope/);
      });
    });
  });

  describe("given no project and no tenant are in hand", () => {
    describe("when a sample answer is produced for each of the four queries", () => {
      /** @scenario "Sample answers are produced without a project or a tenant" */
      it("produces every one of them from a time frame alone", async () => {
        const executeQuery = createSampleExecuteQuery({ frame: FRAME });

        for (const name of Object.keys(EXPECTED_ALIASES)) {
          const result = await executeQuery({
            queryName: name,
            params: {},
            signal: new AbortController().signal,
          });

          expect(result.rows.length).toBeGreaterThan(0);
        }
      });

      /** @scenario "Sample answers are produced without a project or a tenant" */
      it("takes nothing but a time frame, so there is no identifier to read a row on", () => {
        // Checked in the type rather than at runtime on purpose: the proof is
        // that no caller CAN hand this factory a project, not that one call
        // happened not to.
        expectTypeOf(createSampleExecuteQuery)
          .parameter(0)
          .toEqualTypeOf<{ frame: TimeFrame }>();
      });
    });
  });
});
