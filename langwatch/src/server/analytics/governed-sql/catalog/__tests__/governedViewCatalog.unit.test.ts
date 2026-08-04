/**
 * Shape invariants of the governed schema catalog.
 *
 * The catalog is data three things read — the schema endpoint, the AST
 * validator, and the view generator — so a malformed entry is not a crash, it
 * is a wrong answer published as documentation. These are the properties no
 * consumer can check for itself.
 *
 * The content-gating checks deliberately derive their expectation from the
 * data-privacy modules rather than from the catalog, so they can *disagree*
 * with it. A guard that reads the value it guards can only ever agree.
 *
 * @see specs/analytics/governed-sql-api.feature
 */

import { describe, expect, it } from "vitest";

import {
  CONTENT_CATEGORIES,
  type ContentCategory,
} from "../../../../data-privacy/dataPrivacy.types";
import { CONTENT_KEY_CATALOG } from "../../../../data-privacy/dropKeyCatalog";
import {
  CONTENT_ATTRIBUTE_KEYS,
  contentKeyExclusionSql,
  gateForContentCategory,
  isContentAttributeKey,
} from "../contentGating";
import { GOVERNED_VIEW_CATALOG, governedViewByName } from "../governedViews";
import {
  GOVERNED_COLUMN_UNITS,
  type GovernedViewDefinition,
  columnExpression,
  governedAllowedTables,
  governedColumnGates,
  governedContentGatedColumns,
  governedGatedColumns,
  governedViewSourceColumns,
  governedVisibleViews,
  isContentGated,
} from "../types";

/** `Map['key']` accesses in a column expression, with the key captured. */
const MAP_KEY_ACCESS = /\[\s*'([^']+)'\s*\]/g;

/** Stands in for the view's source-table alias when an expression is built. */
const SOURCE = (name: string) => `SRC.\`${name}\``;

/** A column's SQL, with source references qualified the way the generator does. */
const expressionOf = (column: Parameters<typeof columnExpression>[0]) =>
  columnExpression(column, SOURCE);

/** Which content category a span-attribute key belongs to, if any. */
function contentCategoryOf(key: string): ContentCategory | null {
  return (
    CONTENT_CATEGORIES.find((category) =>
      CONTENT_KEY_CATALOG[category].includes(key),
    ) ?? null
  );
}

describe("given the governed view catalog", () => {
  describe("when each entry's shape is checked", () => {
    /** @scenario "Every governed view declares its grain, join keys, and time column" */
    it("declares a grain, join keys, a time column, and a dedup rule per view", () => {
      expect(GOVERNED_VIEW_CATALOG.length).toBeGreaterThan(0);

      for (const view of GOVERNED_VIEW_CATALOG) {
        const columnNames = view.columns.map((column) => column.name);
        expect(view.grain.length, `${view.name} has no grain`).toBeGreaterThan(
          0,
        );
        expect(
          view.freshness.length,
          `${view.name} has no freshness`,
        ).toBeGreaterThan(0);
        expect(
          view.joinKeys.length,
          `${view.name} declares no join keys`,
        ).toBeGreaterThan(0);

        // Everything the entry promises a caller can filter or join on has to
        // be a column the view actually exposes, or the schema endpoint is
        // telling callers to write queries that do not parse.
        expect(
          columnNames,
          `${view.name} advertises a time column it does not expose`,
        ).toContain(view.timeColumn);
        for (const key of view.joinKeys) {
          expect(
            columnNames,
            `${view.name} advertises a join key it does not expose`,
          ).toContain(key);
        }
        expect(
          view.dedup.keyColumns.length,
          `${view.name} has no dedup key`,
        ).toBeGreaterThan(0);

        // The dedup columns must be granted even when nothing exposes them, or
        // the view's own subquery cannot be evaluated.
        const sourceColumns = governedViewSourceColumns(view);
        for (const column of [
          ...view.dedup.keyColumns,
          view.dedup.versionColumn,
        ]) {
          expect(
            sourceColumns,
            `${view.name} deduplicates on ${column} without granting it`,
          ).toContain(column);
        }
      }
    });

    /** @scenario "Every governed view declares its grain, join keys, and time column" */
    it("names every view and every column of a view exactly once", () => {
      const viewNames = GOVERNED_VIEW_CATALOG.map((view) => view.name);
      expect(new Set(viewNames).size).toBe(viewNames.length);

      for (const view of GOVERNED_VIEW_CATALOG) {
        const names = view.columns.map((column) => column.name);
        expect(new Set(names).size, `${view.name} repeats a column`).toBe(
          names.length,
        );
        for (const column of view.columns) {
          expect(
            column.description.trim().length,
            `${view.name}.${column.name} has no description for the schema endpoint`,
          ).toBeGreaterThan(0);
          expect(
            column.type.trim().length,
            `${view.name}.${column.name} has no type`,
          ).toBeGreaterThan(0);
          expect(
            column.sourceColumns.length,
            `${view.name}.${column.name} reads no source column`,
          ).toBeGreaterThan(0);
        }
      }
    });

    /**
     * The bug this guards against shipped once and looked correct: the span
     * view exposes a content-filtered `SpanAttributes` and reads the caller's
     * input out of the unfiltered one, and a bare second reference resolved to
     * the projection alias — so `CapturedInput` was empty for every span while
     * every other assertion passed. A reference that skips the qualifier is not
     * a syntax error, it is a silently wrong answer.
     */
    /** @scenario "Every governed view declares its grain, join keys, and time column" */
    it("qualifies every source-column reference, so no projection alias can shadow one", () => {
      for (const view of GOVERNED_VIEW_CATALOG) {
        for (const column of view.columns) {
          // Strip the qualified references, then look for a bare name in what
          // is left: what remains would resolve against the projection.
          const bare = expressionOf(column).replaceAll(/SRC\.`[^`]+`/g, "");
          for (const source of column.sourceColumns) {
            expect(
              bare.includes(source),
              `${view.name}.${column.name} names ${source} without qualifying it`,
            ).toBe(false);
          }
        }
      }
    });

    /**
     * The expectation is derived from what the column *is* — its name and the
     * sentence the endpoint publishes about it — rather than read back off the
     * `unit` field, so a millisecond column added without a unit turns this red
     * instead of agreeing with itself.
     */
    it("declares a unit on every column that measures something", () => {
      let checked = 0;
      for (const view of GOVERNED_VIEW_CATALOG) {
        for (const column of view.columns) {
          const where = `${view.name}.${column.name}`;
          const expected =
            column.name.endsWith("Ms")
              ? "ms"
              : /\bin USD\b/.test(column.description)
                ? "USD"
                : column.name.endsWith("TokenCount")
                  ? "tokens"
                  : null;
          if (expected === null) continue;
          checked += 1;
          expect(column.unit, `${where} measures ${expected}`).toBe(expected);
        }
      }
      expect(
        checked,
        "no column looks like it measures anything — this guard is inspecting nothing",
      ).toBeGreaterThan(0);
    });

    it("declares no unit on a column that measures nothing", () => {
      const unitless = GOVERNED_VIEW_CATALOG.flatMap((view) =>
        view.columns.filter((column) => column.unit === undefined),
      );
      expect(unitless.length).toBeGreaterThan(0);
      for (const column of unitless) {
        expect(
          /millisecond|in USD|tokens per/i.test(column.description),
          `${column.name} describes a measurement but declares no unit`,
        ).toBe(false);
      }
    });

    it("uses only units from the published vocabulary", () => {
      for (const view of GOVERNED_VIEW_CATALOG) {
        for (const column of view.columns) {
          if (column.unit === undefined) continue;
          expect(
            [...GOVERNED_COLUMN_UNITS],
            `${view.name}.${column.name}`,
          ).toContain(column.unit);
        }
      }
    });

    it("resolves a view by the name a caller writes, and nothing else", () => {
      expect(governedViewByName("traces")?.sourceTable).toBe("trace_summaries");
      expect(governedViewByName("trace_summaries")).toBeUndefined();
    });

    it("qualifies allowed tables with the governed database, never the physical one", () => {
      const allowed = governedAllowedTables({
        database: "analytics",
        views: GOVERNED_VIEW_CATALOG,
      });
      expect(allowed).toContain("analytics.traces");
      for (const view of GOVERNED_VIEW_CATALOG) {
        expect(
          allowed.some((entry) => entry.endsWith(`.${view.sourceTable}`)),
          `the physical table ${view.sourceTable} is nameable by a caller`,
        ).toBe(false);
      }
    });
  });

  describe("when a column reads a key out of an attribute map", () => {
    /**
     * The check that can disagree with the catalog: the expectation comes from
     * the data-privacy key catalog, so declaring a column over `gen_ai.prompt`
     * and forgetting to gate it turns this red without anyone editing a list.
     */
    /** @scenario "The gated column set is derived from the data privacy policy, not hand-listed" */
    it("gates it exactly as the data-privacy policy classifies that key", () => {
      let checked = 0;
      for (const view of GOVERNED_VIEW_CATALOG) {
        for (const column of view.columns) {
          const expression = expressionOf(column);
          for (const match of expression.matchAll(MAP_KEY_ACCESS)) {
            const key = match[1]!;
            const category = contentCategoryOf(key);
            checked += 1;
            if (category === null) {
              expect(
                isContentGated(column),
                `${view.name}.${column.name} reads the non-content key ${key} but is content-gated`,
              ).toBe(false);
              continue;
            }
            expect(
              column.gates,
              `${view.name}.${column.name} reads the content key ${key} without the gate the policy assigns it`,
            ).toContain(gateForContentCategory(category));
          }
        }
      }
      expect(
        checked,
        "no column reads a map key — this guard is inspecting nothing",
      ).toBeGreaterThan(0);
    });

    /**
     * The other half: no *ungated* column may be built over a content key, by
     * any route. Stated separately from the check above because the interesting
     * failure is a column added later whose expression names a key nobody
     * thought to classify.
     */
    /** @scenario "The gated column set is derived from the data privacy policy, not hand-listed" */
    it("keeps every content key out of the ungated columns", () => {
      for (const view of GOVERNED_VIEW_CATALOG) {
        for (const column of view.columns.filter(
          (candidate) => !isContentGated(candidate),
        )) {
          const expression = expressionOf(column);
          for (const match of expression.matchAll(MAP_KEY_ACCESS)) {
            expect(
              isContentAttributeKey(match[1]!),
              `${view.name}.${column.name} is ungated and reads the content key ${match[1]}`,
            ).toBe(false);
          }
        }
      }
    });
  });

  describe("when the map filter is compared with the data-privacy catalog", () => {
    /** @scenario "The gated column set is derived from the data privacy policy, not hand-listed" */
    it("excludes every key the policy classifies as content, and its exploded form", () => {
      const expected = [
        ...new Set(
          CONTENT_CATEGORIES.flatMap(
            (category) => CONTENT_KEY_CATALOG[category],
          ),
        ),
      ].sort();
      expect(
        [...CONTENT_ATTRIBUTE_KEYS],
        "the view's content keys are not the policy's content keys",
      ).toEqual(expected);

      const sql = contentKeyExclusionSql("k");
      for (const key of expected) {
        expect(sql, `the filter never mentions ${key}`).toContain(`'${key}'`);
        expect(
          sql,
          `the filter does not exclude the exploded form of ${key}`,
        ).toContain(`'${key}.'`);
        expect(isContentAttributeKey(key)).toBe(true);
        expect(isContentAttributeKey(`${key}.0.content`)).toBe(true);
      }
      // A dimension the analytics views exist to group by must survive.
      expect(isContentAttributeKey("gen_ai.request.model")).toBe(false);
      expect(isContentAttributeKey("gen_ai.prompt_id")).toBe(false);
    });
  });

  describe("when a caller's permissions are turned into the validator's gated set", () => {
    /** @scenario "The gated column set is derived from the data privacy policy, not hand-listed" */
    it("withholds every gated column from a caller holding nothing", () => {
      const gated = governedGatedColumns({
        protections: {},
        views: GOVERNED_VIEW_CATALOG,
      });
      const everyGatedColumn = [
        ...new Set(
          GOVERNED_VIEW_CATALOG.flatMap((view) =>
            view.columns
              .filter((column) => column.gates.length > 0)
              .map((column) => column.name),
          ),
        ),
      ].sort();
      expect(
        gated,
        "an unresolved permission set withheld less than everything gated",
      ).toEqual(everyGatedColumn);
    });

    /**
     * Fail-closed is the point: `getUserProtectionsForProject` returns
     * `undefined` flags on the path where the policy resolver is down, and that
     * path must withhold rather than expose.
     */
    /** @scenario "The gated column set is derived from the data privacy policy, not hand-listed" */
    it("treats an absent permission as withheld, not as held", () => {
      const undefinedFlags = governedGatedColumns({
        protections: {
          canSeeCapturedInput: undefined,
          canSeeCapturedOutput: null,
          canSeeCosts: undefined,
        },
        views: GOVERNED_VIEW_CATALOG,
      });
      expect(undefinedFlags.length).toBeGreaterThan(0);
      expect(undefinedFlags).toContain("CapturedInput");
      expect(undefinedFlags).toContain("TotalCost");
    });

    it("withholds nothing from a caller holding every permission", () => {
      expect(
        governedGatedColumns({
          protections: {
            canSeeCapturedInput: true,
            canSeeCapturedOutput: true,
            canSeeCosts: true,
          },
          views: GOVERNED_VIEW_CATALOG,
        }),
      ).toEqual([]);
    });

    /**
     * Cost visibility is a separate permission from content visibility, so a
     * caller who may see costs and not content keeps the cost columns.
     */
    it("separates the cost gate from the content gates", () => {
      const contentOnly = governedGatedColumns({
        protections: {
          canSeeCapturedInput: false,
          canSeeCapturedOutput: false,
          canSeeCosts: true,
        },
        views: GOVERNED_VIEW_CATALOG,
      });
      expect(contentOnly).not.toContain("TotalCost");
      expect(contentOnly).toEqual([
        ...governedContentGatedColumns(GOVERNED_VIEW_CATALOG),
      ]);

      const costOnly = governedGatedColumns({
        protections: {
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
          canSeeCosts: false,
        },
        views: GOVERNED_VIEW_CATALOG,
      });
      expect(costOnly).toContain("TotalCost");
      expect(costOnly).not.toContain("CapturedInput");
    });

    /**
     * A dataset can be gated as a whole, and the shipped catalog gates none —
     * pinned here so that gating one is a decision someone made rather than a
     * line that arrived with a copy-pasted entry.
     */
    it("gates no shipped dataset in its entirety", () => {
      for (const view of GOVERNED_VIEW_CATALOG) {
        expect(view.gates, `${view.name} is gated as a whole`).toEqual([]);
      }
    });

    /**
     * A column requiring two permissions is withheld unless both are held.
     * Written as its own case because "some gate is missing" and "every gate is
     * missing" are easy to swap, and the swap only shows up on a column with
     * more than one.
     */
    it("withholds a column needing two permissions when only one is held", () => {
      const outputOnly = governedGatedColumns({
        protections: {
          canSeeCapturedInput: false,
          canSeeCapturedOutput: true,
          canSeeCosts: true,
        },
        views: GOVERNED_VIEW_CATALOG,
      });
      const bothGates = GOVERNED_VIEW_CATALOG.flatMap((view) =>
        view.columns.filter(
          (column) =>
            column.gates.includes("input") && column.gates.includes("output"),
        ),
      );
      expect(
        bothGates.length,
        "no column needs two permissions — this case is inspecting nothing",
      ).toBeGreaterThan(0);
      for (const column of bothGates) {
        expect(outputOnly).toContain(column.name);
      }
    });
  });

  /**
   * Dataset-level gating, exercised on a fixture rather than on the shipped
   * catalog — which gates no dataset, so a case written against it would assert
   * that nothing happens. The mechanism is the same code either way, and the
   * case above pins the shipped catalog's own answer.
   */
  describe("when a dataset is gated as a whole", () => {
    const TRANSCRIPTS: GovernedViewDefinition = {
      name: "transcripts",
      sourceTable: "raw_transcripts",
      description: "Everything said in a conversation, verbatim.",
      gates: ["input"],
      grain: "one row per (TenantId, TranscriptId)",
      joinKeys: ["TenantId"],
      timeColumn: "OccurredAt",
      freshness: "seconds behind ingestion",
      dedup: { keyColumns: ["TenantId"], versionColumn: "UpdatedAt" },
      columns: [
        {
          name: "TenantId",
          type: "String",
          description: "Project the transcript belongs to.",
          gates: [],
          sourceColumns: ["TenantId"],
        },
        {
          name: "Spoken",
          type: "String",
          description: "What was said.",
          gates: ["output"],
          sourceColumns: ["Spoken"],
        },
      ],
    };
    const views = [...GOVERNED_VIEW_CATALOG, TRANSCRIPTS];
    const holding = (input: boolean, output: boolean) => ({
      canSeeCapturedInput: input,
      canSeeCapturedOutput: output,
      canSeeCosts: true,
    });

    it("adds the dataset's permissions to every column's own", () => {
      expect(
        governedColumnGates({
          view: TRANSCRIPTS,
          column: TRANSCRIPTS.columns[0]!,
        }),
      ).toEqual(["input"]);
      expect(
        governedColumnGates({
          view: TRANSCRIPTS,
          column: TRANSCRIPTS.columns[1]!,
        }),
      ).toEqual(["input", "output"]);
    });

    it("leaves a column's gates alone when its dataset is ungated", () => {
      const traces = governedViewByName("traces")!;
      for (const column of traces.columns) {
        expect(governedColumnGates({ view: traces, column })).toBe(
          column.gates,
        );
      }
    });

    it("hides the dataset from a caller who lacks its permission", () => {
      expect(
        governedVisibleViews({
          protections: holding(false, true),
          views,
        }).map((view) => view.name),
      ).not.toContain("transcripts");
    });

    it("shows it to a caller who holds it, so the case above is about the permission", () => {
      expect(
        governedVisibleViews({ protections: holding(true, true), views }).map(
          (view) => view.name,
        ),
      ).toContain("transcripts");
    });

    it("leaves every other dataset visible", () => {
      expect(
        governedVisibleViews({ protections: holding(false, false), views }).map(
          (view) => view.name,
        ),
      ).toEqual(GOVERNED_VIEW_CATALOG.map((view) => view.name));
    });

    /**
     * The half that keeps the schema endpoint and the validator agreeing: a
     * dataset the endpoint hides has every column in the withheld set, so
     * naming one is refused rather than silently answered.
     */
    it("withholds every column of the hidden dataset", () => {
      const withheld = governedGatedColumns({
        protections: holding(false, true),
        views,
      });
      for (const column of TRANSCRIPTS.columns) {
        expect(withheld, `${column.name} is readable in a hidden dataset`).toContain(
          column.name,
        );
      }
    });

    it("withholds none of them from a caller holding the dataset's permission", () => {
      expect(
        governedGatedColumns({ protections: holding(true, true), views }),
      ).toEqual([]);
    });
  });
});
