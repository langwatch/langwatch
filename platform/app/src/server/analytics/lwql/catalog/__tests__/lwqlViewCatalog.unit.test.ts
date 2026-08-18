/**
 * Shape invariants of the LangWatchQL schema catalog.
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
 * @see specs/analytics/lwql-api.feature
 */

import { describe, expect, it } from "vitest";

import {
  CONTENT_CATEGORIES,
  type ContentCategory,
} from "../../../../data-privacy/dataPrivacy.types";
import { CONTENT_KEY_CATALOG } from "../../../../data-privacy/dropKeyCatalog";
import { GATED_DATASET } from "../../__tests__/gatedDatasetFixture";
import {
  CONTENT_ATTRIBUTE_KEYS,
  contentKeyExclusionSql,
  gateForContentCategory,
  isContentAttributeKey,
} from "../contentGating";
import { LWQL_VIEW_CATALOG, lwqlViewByName } from "../lwqlViews";
import {
  columnExpression,
  LWQL_COLUMN_UNITS,
  lwqlAllowedTables,
  lwqlColumnGates,
  lwqlContentGatedColumns,
  lwqlGatedColumns,
  lwqlGrainColumns,
  lwqlViewSourceColumns,
  lwqlVisibleViews,
  isContentGated,
  isPostgresResident,
} from "../types";

/** `Map['key']` accesses in a column expression, with the key captured. */
const MAP_KEY_ACCESS = /\[\s*'([^']+)'\s*\]/g;

/** Stands in for the view's source-table alias when an expression is built. */
const SOURCE = (name: string) => `SRC.\`${name}\``;

/** A column's SQL, with source references qualified the way the generator does. */
const expressionOf = (
  column: Parameters<typeof columnExpression>[0]["column"],
) => columnExpression({ column, source: SOURCE });

/** Which content category a span-attribute key belongs to, if any. */
function contentCategoryOf(key: string): ContentCategory | null {
  return (
    CONTENT_CATEGORIES.find((category) =>
      CONTENT_KEY_CATALOG[category].includes(key),
    ) ?? null
  );
}

describe("given the LangWatchQL view catalog", () => {
  describe("when each entry's shape is checked", () => {
    /** @scenario "Every LangWatchQL view declares its grain, join keys, and time column" */
    it("declares a grain, join keys, a time column, and a dedup rule per view", () => {
      expect(LWQL_VIEW_CATALOG.length).toBeGreaterThan(0);

      for (const view of LWQL_VIEW_CATALOG) {
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

        // Both key sets are read against the columns a caller can actually
        // name — the grain by the fanout diagnostic, the engine key by the view
        // body — so both have to be exposed, whichever residence the dataset
        // has. The exception is a grouped render: an engine-key column outside
        // the published grain is grouped away there, and exposing it would
        // reintroduce the breakdown the view exists to sum over.
        const grouped =
          view.dedup.aggregating === true &&
          lwqlGrainColumns(view).length < view.dedup.keyColumns.length;
        for (const column of [
          ...(grouped ? [] : view.dedup.keyColumns),
          ...lwqlGrainColumns(view),
        ]) {
          expect(
            columnNames,
            `${view.name} declares a key column it does not expose`,
          ).toContain(column);
        }

        // A grain wider than the key the engine collapses on would mean the
        // engine merges rows the dataset calls distinct — lost data, not a
        // duplicate. It is also what keeps the grant sufficient: the source
        // columns are derived from the key columns, and the `in-tuple` body
        // names the grain.
        for (const column of lwqlGrainColumns(view)) {
          expect(
            view.dedup.keyColumns,
            `${view.name} calls ${column} part of its grain, but its source does not sort by it`,
          ).toContain(column);
        }

        // `none` is the measurement baseline: pinned on an entry it would ship
        // every unmerged version as its own row.
        expect(
          view.dedup.strategy,
          `${view.name} pins the dedup strategy that does not deduplicate`,
        ).not.toBe("none");

        if (isPostgresResident(view)) {
          // Nothing to collapse: PostgreSQL keeps one row per key, and a
          // version column here would be a claim about an engine that is not
          // underneath this dataset.
          expect(
            view.dedup.versionColumn,
            `${view.name} is PostgreSQL-resident and has no versions to collapse`,
          ).toBeUndefined();
          continue;
        }

        // Asserted before the grant loop, not inside it: `versionColumn` is
        // optional, and an entry that forgot it would otherwise fail as
        // "deduplicates on undefined without granting it" — which reads as a
        // broken guard rather than as the missing declaration it is.
        //
        // An aggregating source is the one ClickHouse-resident shape with no
        // version, because its rows for a key are summed rather than
        // superseded. It has to say so, or "no version column" is
        // indistinguishable from a `ReplacingMergeTree` entry that forgot one.
        if (view.dedup.aggregating) {
          expect(
            view.dedup.versionColumn,
            `${view.name} aggregates, so no version supersedes another and declaring one would be a claim about an engine that is not underneath it`,
          ).toBeUndefined();
        } else {
          expect(
            view.dedup.versionColumn,
            `${view.name} is ClickHouse-resident and declares no version column, so its view would silently double-count`,
          ).toBeDefined();
        }

        // A ClickHouse-resident view builds its own dedup subquery, so the same
        // columns must additionally be granted on the source table — even when
        // nothing exposes them — or that subquery cannot be evaluated.
        const sourceColumns = lwqlViewSourceColumns(view);
        for (const column of [
          ...view.dedup.keyColumns,
          ...(view.dedup.versionColumn ? [view.dedup.versionColumn] : []),
        ]) {
          expect(
            sourceColumns,
            `${view.name} deduplicates on ${column} without granting it`,
          ).toContain(column);
        }
      }
    });

    /** @scenario "Every LangWatchQL view declares its grain, join keys, and time column" */
    it("names every view and every column of a view exactly once", () => {
      const viewNames = LWQL_VIEW_CATALOG.map((view) => view.name);
      expect(new Set(viewNames).size).toBe(viewNames.length);

      for (const view of LWQL_VIEW_CATALOG) {
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
    /** @scenario "Every LangWatchQL view declares its grain, join keys, and time column" */
    it("qualifies every source-column reference, so no projection alias can shadow one", () => {
      for (const view of LWQL_VIEW_CATALOG) {
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
      for (const view of LWQL_VIEW_CATALOG) {
        for (const column of view.columns) {
          const where = `${view.name}.${column.name}`;
          const expected = column.name.endsWith("Ms")
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
      const unitless = LWQL_VIEW_CATALOG.flatMap((view) =>
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
      for (const view of LWQL_VIEW_CATALOG) {
        for (const column of view.columns) {
          if (column.unit === undefined) continue;
          expect(
            [...LWQL_COLUMN_UNITS],
            `${view.name}.${column.name}`,
          ).toContain(column.unit);
        }
      }
    });

    it("resolves a view by the name a caller writes, and nothing else", () => {
      expect(lwqlViewByName("traces")?.sourceTable).toBe("trace_summaries");
      expect(lwqlViewByName("trace_summaries")).toBeUndefined();
    });

    it("qualifies allowed tables with the LangWatchQL database, never the physical one", () => {
      const allowed = lwqlAllowedTables({
        database: "analytics",
        views: LWQL_VIEW_CATALOG,
      });
      expect(allowed).toContain("analytics.traces");
      for (const view of LWQL_VIEW_CATALOG) {
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
      for (const view of LWQL_VIEW_CATALOG) {
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
      for (const view of LWQL_VIEW_CATALOG) {
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

    /**
     * The map is the one place a view can hand a caller captured content
     * without naming a gated column, because a ClickHouse grant bounds columns
     * and not keys inside one. Stated over the whole catalog rather than over
     * the maps someone remembered, so a dataset added with an unfiltered map
     * fails here.
     */
    /** @scenario "The analytics-optimised datasets expose no captured content" */
    it("filters the content keys out of every map column any dataset exposes", () => {
      let checked = 0;
      for (const view of LWQL_VIEW_CATALOG) {
        for (const column of view.columns.filter((candidate) =>
          candidate.type.startsWith("Map("),
        )) {
          checked += 1;
          expect(
            expressionOf(column),
            `${view.name}.${column.name} is a map the caller reads unfiltered`,
          ).toContain(contentKeyExclusionSql("k"));
        }
      }
      expect(
        checked,
        "no dataset exposes a map — this guard is inspecting nothing",
      ).toBeGreaterThan(0);
    });
  });

  /**
   * The analytics projections and their rollups (issue #6856). The fold never
   * writes captured content onto them, so nothing on them is content-gated —
   * pinned here so that adding a captured-content column to one is a decision
   * someone made rather than a line that arrived with a copy-pasted entry.
   */
  describe("when the analytics projections are inspected", () => {
    // The property, not a name list: an analytics dataset is one that reads a
    // fold projection or its rollup, so a sixth one added later is covered on
    // arrival rather than left off an "expected" list.
    const analyticsDatasets = LWQL_VIEW_CATALOG.filter((view) =>
      /_analytics(_rollup)?$/.test(view.sourceTable),
    );

    /** @scenario "The analytics-optimised datasets expose no captured content" */
    it("exposes no content-gated column on any of them", () => {
      expect(
        analyticsDatasets.length,
        "no dataset reads an analytics projection — this case is inspecting nothing",
      ).toBeGreaterThan(0);
      for (const view of analyticsDatasets) {
        expect(
          view.columns.filter(isContentGated).map((column) => column.name),
          `${view.name} exposes captured content`,
        ).toEqual([]);
      }
    });

    /**
     * The control. Without it the case above passes on a catalog in which
     * nothing anywhere is content-gated, which would be the same words
     * describing a very different schema.
     */
    it("is a claim about those datasets, because the complete records do gate content", () => {
      for (const name of ["traces", "evaluations", "simulations"] as const) {
        const view = lwqlViewByName(name);
        expect(view, `${name} is not in the catalog`).toBeDefined();
        expect(
          view!.columns.filter(isContentGated).length,
          `${name} gates no content, so the analytics case above distinguishes nothing`,
        ).toBeGreaterThan(0);
      }
    });
  });

  /**
   * An `AggregatingMergeTree` source: its rows for one key are summed rather
   * than one superseding the others, which is a third answer to "which row
   * survives" and the one that cannot be inferred from the other two.
   */
  describe("when a dataset's source aggregates rather than supersedes", () => {
    const aggregating = LWQL_VIEW_CATALOG.filter(
      (view) => view.dedup.aggregating,
    );

    /** @scenario "A pre-aggregated dataset declares that its rows merge rather than supersede" */
    it("declares every column that is not a measure as a key its rows merge on", () => {
      expect(
        aggregating.length,
        "no dataset aggregates — this case is inspecting nothing",
      ).toBeGreaterThan(0);

      for (const view of aggregating) {
        // Every column is one of two things: a dimension of the published
        // grain, or a measure that merges. A dimension missing from the grain
        // is the silent failure — the view would sum across it and add two
        // models' costs together under one row that never says so. Read
        // against the grain rather than the engine key, because a grouped
        // render deliberately keeps engine-key breakdowns out of its columns.
        //
        // Which is which is read from the column's own `summed` declaration
        // rather than from "it has an expression": an expression is how a
        // measure used to be written, and any column can have one — the
        // filtered attribute maps do — so classifying by its presence would
        // have called a filtered map a measure and a hand-written measure a
        // dimension.
        const measures = view.columns
          .filter((column) => column.summed)
          .map((column) => column.name);
        expect(
          [...lwqlGrainColumns(view), ...measures].sort(),
          `${view.name} has a column that is neither a dimension of its published grain nor a measure that merges`,
        ).toEqual(view.columns.map((column) => column.name).sort());
        expect(
          view.dedup.keyColumns.filter((key) => measures.includes(key)),
          `${view.name} merges on a column that is itself a measure`,
        ).toEqual([]);
      }
    });

    /**
     * Every column of a rollup is a sum, so a join matching less than the whole
     * bucket key does not repeat a row — it adds several buckets' measures
     * together under one. Advertising the prefix as the join surface is
     * therefore advertising a wrong number.
     */
    /** @scenario "A pre-aggregated dataset advertises its whole bucket key as its join keys" */
    it("advertises the whole bucket key as its join keys, not a prefix of it", () => {
      for (const view of aggregating) {
        expect(
          [...view.joinKeys].sort(),
          `${view.name} advertises a join on part of its bucket key, which multiplies its measures`,
        ).toEqual([...lwqlGrainColumns(view)].sort());
      }
    });

    /**
     * The control for the case above: a dataset whose rows are records rather
     * than buckets legitimately advertises a foreign key it is *not* unique on
     * — `evaluations` joins to `traces` on `TraceId`, many to one — and the
     * fanout diagnostic is what tells a caller about that. Without this, the
     * rule above could be read as "join keys are always the grain", which the
     * shipped catalog does not say and must not start saying.
     */
    /** @scenario "A pre-aggregated dataset advertises its whole bucket key as its join keys" */
    it("leaves a record dataset free to advertise a foreign key it is not unique on", () => {
      const evaluations = lwqlViewByName("evaluations")!;
      expect([...evaluations.joinKeys].sort()).not.toEqual(
        [...lwqlGrainColumns(evaluations)].sort(),
      );
    });

    /** @scenario "A pre-aggregated dataset declares that its rows merge rather than supersede" */
    it("leaves a versioned dataset's version column required, so this is not a blanket exemption", () => {
      const versioned = LWQL_VIEW_CATALOG.filter(
        (view) => !view.dedup.aggregating && !isPostgresResident(view),
      );
      expect(
        versioned.length,
        "no dataset keeps versions — this case is inspecting nothing",
      ).toBeGreaterThan(0);
      for (const view of versioned) {
        expect(view.dedup.versionColumn, `${view.name}`).toBeDefined();
      }
    });
  });

  /**
   * The dataset whose engine key and grain come apart. `evaluation_analytics`
   * sorts by `(TenantId, OccurredAt, EvaluationId)` and its fold writes a moving
   * watermark into `OccurredAt`, so the engine sees one evaluation's versions as
   * different keys — `FINAL` keeps all of them and every aggregate counts the
   * evaluation once per version, with nothing in the result that looks wrong.
   */
  describe("when a dataset's source sorts by a column its write path moves", () => {
    const evaluationMetrics = lwqlViewByName("evaluation_metrics")!;

    /** @scenario "A dataset whose sort key moves declares the strategy that deduplicates it" */
    it("deduplicates by the record rather than by the engine's key", () => {
      expect(
        evaluationMetrics.dedup.strategy,
        "evaluation_metrics takes the default strategy, which collapses on a key its source moves",
      ).toBe("in-tuple");
      expect([...lwqlGrainColumns(evaluationMetrics)]).toEqual([
        "TenantId",
        "EvaluationId",
      ]);
      expect(
        lwqlGrainColumns(evaluationMetrics).length,
        "the grain is the whole sort key, so this dataset needs no strategy of its own",
      ).toBeLessThan(evaluationMetrics.dedup.keyColumns.length);
      expect(evaluationMetrics.dedup.versionColumn).toBe("UpdatedAt");
    });

    /**
     * The control. Pinning a strategy is a claim about one source table, and a
     * catalog that pinned it everywhere would have moved the default instead —
     * paying an unbounded subquery per query on every dataset to fix one. The
     * property, not a name list: every pinned entry must be the shape that
     * needs one — a record grain narrower than the engine's key on a
     * versioned source. A name list would lock the next violation in as
     * "expected".
     */
    /** @scenario "A dataset whose sort key moves declares the strategy that deduplicates it" */
    it("leaves the datasets whose sort keys hold still on the shipped default", () => {
      const pinned = LWQL_VIEW_CATALOG.filter(
        (view) => view.dedup.strategy !== undefined,
      );
      expect(
        pinned.length,
        "no dataset pins a strategy — this case is inspecting nothing",
      ).toBeGreaterThan(0);
      for (const view of pinned) {
        expect(
          lwqlGrainColumns(view).length,
          `${view.name} pins a strategy its grain does not call for — the shipped default already collapses on the whole key`,
        ).toBeLessThan(view.dedup.keyColumns.length);
        expect(
          view.dedup.aggregating,
          `${view.name} aggregates, so its narrow grain is delivered by the GROUP BY render, not a pinned strategy`,
        ).not.toBe(true);
      }
    });

    /**
     * The catalog-wide invariant the `grainColumns` doc points at: a grain
     * narrower than the engine's key is a claim plain `FINAL` cannot honour —
     * the engine collapses to its own sort key and nothing narrower, so the
     * view would return extra rows per logical row. Only two shapes can
     * deliver a narrower grain: `in-tuple`, which selects by the grain
     * itself, and an aggregating source, whose view is rendered as a
     * `GROUP BY` over the grain.
     */
    /** @scenario "A dataset whose sort key moves declares the strategy that deduplicates it" */
    it("requires a grain narrower than the engine's key to name a strategy that can deliver it", () => {
      const narrower = LWQL_VIEW_CATALOG.filter(
        (view) =>
          !isPostgresResident(view) &&
          lwqlGrainColumns(view).length < view.dedup.keyColumns.length,
      );
      expect(
        narrower.length,
        "no dataset narrows its grain — this case is inspecting nothing",
      ).toBeGreaterThan(0);
      for (const view of narrower) {
        expect(
          view.dedup.strategy === "in-tuple" || view.dedup.aggregating === true,
          `${view.name} publishes a grain narrower than its engine's key under plain FINAL, which merges on the whole key and cannot deliver it`,
        ).toBe(true);
      }
    });
  });

  /**
   * A measure's SQL, which is the one thing about a rollup column that can be
   * wrong without anything noticing: a cast returns a number whatever column it
   * reads, and a fixture whose measures share a value agrees with either
   * reading. So the column states what it is once — its name, its published
   * type, and `summed` — and the SQL is derived from those rather than written
   * a second time beside them.
   */
  describe("when a summed measure is declared", () => {
    const summed = LWQL_VIEW_CATALOG.flatMap((view) =>
      view.columns
        .filter((column) => column.summed)
        .map((column) => ({ view, column })),
    );

    /** @scenario "A summed measure reads the column it is named after" */
    it("reads its own column, so no measure can be labelled as another", () => {
      expect(
        summed.length,
        "no dataset declares a summed measure — this case is inspecting nothing",
      ).toBeGreaterThan(0);

      for (const { view, column } of summed) {
        expect(
          [...column.sourceColumns],
          `${view.name}.${column.name} is a summed measure reading another column, which no cast or type would reveal`,
        ).toEqual([column.name]);
      }
    });

    /** @scenario "A summed measure reads the column it is named after" */
    it("casts it to exactly the type the schema endpoint publishes", () => {
      for (const { view, column } of summed) {
        expect(
          expressionOf(column),
          `${view.name}.${column.name} does not read back as the type it publishes`,
        ).toBe(`to${column.type}(${SOURCE(column.name)})`);
      }
    });

    /**
     * The flag says "the engine stores this as `SimpleAggregateFunction(sum,
     * …)`", which is only true under an `AggregatingMergeTree`. On any other
     * source the cast would be describing an engine that is not underneath it.
     */
    /** @scenario "A summed measure reads the column it is named after" */
    it("appears only on a dataset whose source aggregates", () => {
      for (const { view, column } of summed) {
        expect(
          view.dedup.aggregating,
          `${view.name}.${column.name} is summed, but ${view.sourceTable} does not aggregate`,
        ).toBe(true);
      }
    });

    /**
     * The derivation refuses to be talked out of itself. Both refusals are the
     * same guarantee from two directions: the SQL for a summed measure comes
     * from the column, and there is no way to supply SQL that says otherwise.
     */
    /** @scenario "A summed measure reads the column it is named after" */
    it("refuses a hand-written expression beside the flag", () => {
      expect(() =>
        expressionOf({
          name: "TraceCount",
          type: "UInt64",
          description: "Traces in the bucket.",
          gates: [],
          sourceColumns: ["TraceCount"],
          summed: true,
          expression: (source) => `toUInt64(${source("SpanCount")})`,
        }),
      ).toThrow(/summed measure and also declares an expression/);
    });

    it("refuses a type the merged total cannot be cast to", () => {
      expect(() =>
        expressionOf({
          name: "CostSum",
          type: "Nullable(Float64)",
          description: "Cost of the bucket.",
          gates: [],
          sourceColumns: ["CostSum"],
          summed: true,
        }),
      ).toThrow(/not a plain numeric type/);
    });
  });

  describe("when a caller's permissions are turned into the validator's gated set", () => {
    /** @scenario "The gated column set is derived from the data privacy policy, not hand-listed" */
    it("withholds every gated column from a caller holding nothing", () => {
      const gated = lwqlGatedColumns({
        protections: {},
        views: LWQL_VIEW_CATALOG,
      });
      const everyGatedColumn = [
        ...new Set(
          LWQL_VIEW_CATALOG.flatMap((view) =>
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
      const undefinedFlags = lwqlGatedColumns({
        protections: {
          canSeeCapturedInput: undefined,
          canSeeCapturedOutput: null,
          canSeeCosts: undefined,
        },
        views: LWQL_VIEW_CATALOG,
      });
      expect(undefinedFlags.length).toBeGreaterThan(0);
      expect(undefinedFlags).toContain("CapturedInput");
      expect(undefinedFlags).toContain("TotalCost");
    });

    it("withholds nothing from a caller holding every permission", () => {
      expect(
        lwqlGatedColumns({
          protections: {
            canSeeCapturedInput: true,
            canSeeCapturedOutput: true,
            canSeeCosts: true,
          },
          views: LWQL_VIEW_CATALOG,
        }),
      ).toEqual([]);
    });

    /**
     * Cost visibility is a separate permission from content visibility, so a
     * caller who may see costs and not content keeps the cost columns.
     */
    it("separates the cost gate from the content gates", () => {
      const contentOnly = lwqlGatedColumns({
        protections: {
          canSeeCapturedInput: false,
          canSeeCapturedOutput: false,
          canSeeCosts: true,
        },
        views: LWQL_VIEW_CATALOG,
      });
      expect(contentOnly).not.toContain("TotalCost");
      expect(contentOnly).toEqual([
        ...lwqlContentGatedColumns(LWQL_VIEW_CATALOG),
      ]);

      const costOnly = lwqlGatedColumns({
        protections: {
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
          canSeeCosts: false,
        },
        views: LWQL_VIEW_CATALOG,
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
      for (const view of LWQL_VIEW_CATALOG) {
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
      const outputOnly = lwqlGatedColumns({
        protections: {
          canSeeCapturedInput: false,
          canSeeCapturedOutput: true,
          canSeeCosts: true,
        },
        views: LWQL_VIEW_CATALOG,
      });
      const bothGates = LWQL_VIEW_CATALOG.flatMap((view) =>
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
    const views = [...LWQL_VIEW_CATALOG, GATED_DATASET];
    const holding = (input: boolean, output: boolean) => ({
      canSeeCapturedInput: input,
      canSeeCapturedOutput: output,
      canSeeCosts: true,
    });

    it("adds the dataset's permissions to every column's own", () => {
      // By name rather than by index, so a column added to the fixture cannot
      // silently shift which shape each assertion exercises.
      const column = (name: string) => {
        const found = GATED_DATASET.columns.find(
          (candidate) => candidate.name === name,
        );
        if (!found) throw new Error(`fixture lost its ${name} column`);
        return found;
      };
      expect(
        lwqlColumnGates({
          view: GATED_DATASET,
          column: column("TranscriptId"),
        }),
      ).toEqual(["input"]);
      expect(
        lwqlColumnGates({
          view: GATED_DATASET,
          column: column("Spoken"),
        }),
      ).toEqual(["input", "output"]);
    });

    it("leaves a column's gates alone when its dataset is ungated", () => {
      const traces = lwqlViewByName("traces")!;
      for (const column of traces.columns) {
        expect(lwqlColumnGates({ view: traces, column })).toBe(
          column.gates,
        );
      }
    });

    it("hides the dataset from a caller who lacks its permission", () => {
      expect(
        lwqlVisibleViews({
          protections: holding(false, true),
          views,
        }).map((view) => view.name),
      ).not.toContain(GATED_DATASET.name);
    });

    it("shows it to a caller who holds it, so the case above is about the permission", () => {
      expect(
        lwqlVisibleViews({ protections: holding(true, true), views }).map(
          (view) => view.name,
        ),
      ).toContain(GATED_DATASET.name);
    });

    it("leaves every other dataset visible", () => {
      expect(
        lwqlVisibleViews({ protections: holding(false, false), views }).map(
          (view) => view.name,
        ),
      ).toEqual(LWQL_VIEW_CATALOG.map((view) => view.name));
    });

    /**
     * The half that keeps the schema endpoint and the validator agreeing: a
     * dataset the endpoint hides has every column in the withheld set, so
     * naming one is refused rather than silently answered.
     */
    it("withholds every column of the hidden dataset", () => {
      const withheld = lwqlGatedColumns({
        protections: holding(false, true),
        views,
      });
      for (const column of GATED_DATASET.columns) {
        expect(
          withheld,
          `${column.name} is readable in a hidden dataset`,
        ).toContain(column.name);
      }
    });

    it("withholds none of them from a caller holding the dataset's permission", () => {
      expect(
        lwqlGatedColumns({ protections: holding(true, true), views }),
      ).toEqual([]);
    });
  });
});
