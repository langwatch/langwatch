/**
 * The LangWatchQL `analytics.*` views, proven over the real fact tables.
 *
 * Everything here runs against a ClickHouse 25.10 server carrying the *shipped*
 * migrations — not a fixture schema — with the shipped provisioning applied and
 * every read executed as the actual restricted database identity. That is the
 * bar the feature file sets: a view that deduplicates correctly against two toy
 * `MergeTree` tables has proven nothing about a `ReplacingMergeTree` holding
 * eight weekly partitions.
 *
 * Three habits, each answering a way this kind of suite goes quietly vacuous:
 *
 *  - Every absence claim is paired with an administrator-side control proving
 *    the thing it failed to find exists.
 *  - Every rejection is asserted by specific ClickHouse error code. "It threw"
 *    is not containment when a typo throws too.
 *  - The catalog's declared types are checked against `system.columns` rather
 *    than trusted, so a migration that changes a column turns this red instead
 *    of turning the schema endpoint into a liar.
 *
 * @see specs/analytics/lwql-api.feature
 * @see ../views.ts — the statements under proof
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONTENT_CATEGORIES } from "../../../data-privacy/dataPrivacy.types";
import { CONTENT_KEY_CATALOG } from "../../../data-privacy/dropKeyCatalog";
import { LWQL_VIEW_CATALOG } from "../catalog/lwqlViews";
import {
  type LangWatchQLDedupStrategy,
  lwqlAllowedTables,
  lwqlGatedColumns,
  lwqlGrainColumns,
  isContentGated,
  isPostgresResident,
} from "../catalog/types";
import {
  definerViewAuditQuery,
  dropLangWatchQLRowPolicyStatement,
  lwqlPolicyCoverageQuery,
  lwqlRowPolicyStatement,
} from "../provisioning";
import { validateLangWatchQL } from "../validation/validate";
import {
  lwqlGrantedSourceColumns,
  lwqlSourceTables,
  lwqlViewSetupStatements,
  lwqlViewStatement,
  SHIPPED_LWQL_DEDUP,
} from "../views";
import {
  CLICKHOUSE_ERROR_CODE,
  DEDUP_FIXTURE,
  dedupTraceId,
  EVALUATION_DEDUP_FIXTURE,
  evaluationDedupId,
  expectClickHouseError,
  expectOnlyTenantA,
  type LangWatchQLClickHouseHarness,
  type LangWatchQLPostgresHarness,
  MOVED_PARTITION_FIXTURE,
  mapPostgresIntoClickHouse,
  measureQuery,
  movedPartitionTraceId,
  ROLLUP_MERGE_FIXTURE,
  ROLLUP_MERGE_TOTALS,
  recordSeedControl,
  SEED_RECENT_WEEK,
  SEEDED_CONTENT,
  SEEDED_DIMENSION_ATTRIBUTE,
  selectRows,
  selectScalar,
  startLangWatchQLClickHouse,
  startLangWatchQLPostgres,
} from "./lwqlClickHouseHarness";

/** A column no view exposes, so the grant must make it unreachable. */
const OFF_CATALOG_COLUMN = "ProjectionId";

/** The eight expression positions the content-gating policy enumerates. */
const GATED_COLUMN_POSITIONS = (database: string) =>
  [
    ["projection", `SELECT CapturedInput FROM ${database}.traces`],
    [
      "filter",
      `SELECT TraceId FROM ${database}.traces WHERE CapturedInput != ''`,
    ],
    ["group", `SELECT count() FROM ${database}.traces GROUP BY CapturedInput`],
    ["order", `SELECT TraceId FROM ${database}.traces ORDER BY CapturedInput`],
    [
      "having",
      `SELECT count() FROM ${database}.traces GROUP BY TraceId HAVING max(CapturedInput) != ''`,
    ],
    [
      "join",
      `SELECT t.TraceId FROM ${database}.traces AS t ` +
        `INNER JOIN ${database}.spans AS s ON s.TraceId = t.CapturedInput`,
    ],
    [
      "window",
      `SELECT row_number() OVER (PARTITION BY CapturedInput) FROM ${database}.traces`,
    ],
    [
      "subquery",
      `SELECT TraceId FROM ${database}.traces ` +
        `WHERE TraceId IN (SELECT CapturedInput FROM ${database}.traces)`,
    ],
  ] as const;

describe("given the LangWatchQL views provisioned over the shipped fact tables", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;
  /** The restricted identity carrying tenant-a's valid key-hash context. */
  let tenantA: ClickHouseClient;
  let database: string;
  let facts: string;

  const applyShippedViews = async (): Promise<void> => {
    await harness.applyAsAdmin(
      lwqlViewSetupStatements({
        names: harness.names,
        sourceDatabase: harness.factDatabase,
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    );
  };

  beforeAll(async () => {
    // The catalog spans both residences, and the LangWatchQL views over the
    // PostgreSQL-resident half cannot be created until the engine tables they
    // read exist. Stood up before the views for that reason, not because this
    // suite is about PostgreSQL — `postgresEngineIsolation` is.
    postgres = await startLangWatchQLPostgres();
    harness = await startLangWatchQLClickHouse({
      suite: "views",
      facts: "migrated",
    });
    database = harness.names.database;
    facts = harness.factDatabase;
    await mapPostgresIntoClickHouse({ harness, postgres });
    await applyShippedViews();
    tenantA = await harness.restrictedClient({
      keyHash: harness.tenantA.keyHash,
    });
  }, 600_000);

  afterAll(async () => {
    await harness?.stop();
    await postgres?.stop();
  });

  describe("when the catalog is compared against the tables the migrations created", () => {
    /**
     * The catalog is what the schema endpoint publishes, so a type it declares
     * that the table does not have is a lie told to every caller. Checked
     * against `system.columns` rather than against the migration text, because
     * the migrations are a sequence of `ALTER`s and the resulting type is what
     * matters.
     */
    /** @scenario "The catalog's declared columns match the tables the views read" */
    it("declares only columns the source tables have", async () => {
      // The source of a PostgreSQL-resident dataset is its engine table in the
      // LangWatchQL database, not a migrated fact table, so where to look is
      // derived from the catalog rather than assumed to be one database.
      const sources = new Map(
        lwqlSourceTables({
          names: harness.names,
          sourceDatabase: facts,
        }).map((source) => [source.table, source.database ?? database]),
      );

      for (const view of LWQL_VIEW_CATALOG) {
        const actual = await selectRows<{ name: string; type: string }>(
          harness.admin,
          `SELECT name, type FROM system.columns ` +
            `WHERE database = '${sources.get(view.sourceTable)}' AND table = '${view.sourceTable}'`,
        );
        expect(
          actual.length,
          `${view.sourceTable} has no columns — the migrations or the PostgreSQL mapping did not run`,
        ).toBeGreaterThan(0);
        const known = new Set(actual.map((column) => column.name));

        const missing = lwqlGrantedSourceColumns(view).filter(
          (column) => !known.has(column),
        );
        expect(
          missing,
          `${view.name} reads columns ${view.sourceTable} does not have`,
        ).toEqual([]);
      }
    });

    /** @scenario "The catalog's declared columns match the tables the views read" */
    it("declares the types the views actually return", async () => {
      for (const view of LWQL_VIEW_CATALOG) {
        const actual = await selectRows<{ name: string; type: string }>(
          harness.admin,
          `SELECT name, type FROM system.columns ` +
            `WHERE database = '${database}' AND table = '${view.name}'`,
        );
        const byName = new Map(
          actual.map((column) => [column.name, column.type]),
        );
        expect(
          actual.length,
          `${view.name} exposes ${actual.length} columns, the catalog declares ${view.columns.length}` +
            (actual.length === 0 ? " — the view was not created" : ""),
        ).toBe(view.columns.length);

        const wrong = view.columns
          .filter((column) => byName.get(column.name) !== column.type)
          .map(
            (column) =>
              `${view.name}.${column.name}: catalog says ${column.type}, view returns ${byName.get(column.name)}`,
          );
        expect(wrong).toEqual([]);
      }
    });

    /**
     * The rule the catalog states and nothing enforced: an entry's key columns
     * are the source's whole `ORDER BY`. Everything downstream is derived from
     * that claim — the `final` strategy collapses on the table's sort key and on
     * nothing an entry says, so a wrong declaration produces a view that
     * deduplicates differently from the catalog's description of it, and a
     * fanout diagnostic that describes a key the engine is not using.
     *
     * Read from `system.tables` rather than from the migration text, because the
     * migrations are a sequence of `CREATE`s and `ALTER`s and the resulting sort
     * key is what the engine merges on.
     */
    /** @scenario "Every LangWatchQL view's dedup declaration matches the table it reads" */
    it("declares the sort key and the engine its source table actually has", async () => {
      const resident = LWQL_VIEW_CATALOG.filter(
        (candidate) => !isPostgresResident(candidate),
      );
      expect(
        resident.length,
        "no ClickHouse-resident dataset — this case is inspecting nothing",
      ).toBeGreaterThan(0);

      for (const view of resident) {
        const [source] = await selectRows<{
          sorting_key: string;
          engine: string;
          engine_full: string;
        }>(
          harness.admin,
          `SELECT sorting_key, engine, engine_full FROM system.tables ` +
            `WHERE database = '${facts}' AND name = '${view.sourceTable}'`,
        );
        expect(
          source,
          `${view.sourceTable} is not on the server — the migrations did not run`,
        ).toBeDefined();

        const sortingKey = source!.sorting_key.split(", ");
        expect(
          [...view.dedup.keyColumns],
          `${view.name} declares a key its source does not sort by`,
        ).toEqual(sortingKey);

        // The grain can be narrower than the sort key — that is what a
        // time-leading analytics table is — but never something the engine does
        // not sort by, which would be a row identity no dedup shape can honour.
        for (const column of lwqlGrainColumns(view)) {
          expect(
            sortingKey,
            `${view.name} calls ${column} part of its grain, but ${view.sourceTable} does not sort by it`,
          ).toContain(column);
        }

        // The engine family, both ways round: an entry says its rows are summed
        // or superseded, and the table has to be the engine that does it.
        expect(
          source!.engine.includes("AggregatingMergeTree"),
          `${view.name} declares aggregating=${String(Boolean(view.dedup.aggregating))} over ${source!.engine}`,
        ).toBe(Boolean(view.dedup.aggregating));
        expect(
          source!.engine.includes("ReplacingMergeTree"),
          `${view.name} declares versionColumn=${String(view.dedup.versionColumn)} over ${source!.engine}`,
        ).toBe(view.dedup.versionColumn !== undefined);

        // And the *named* version column is the engine's own, which is the trap
        // `stored_spans` sets: it supersedes on `StartTime`, not `UpdatedAt`.
        if (view.dedup.versionColumn) {
          const engineArguments = /^\w+\(([^)]*)\)/
            .exec(source!.engine_full)?.[1]
            ?.split(/,\s*/);
          expect(
            engineArguments,
            `${view.name} reads ${source!.engine_full}, which supersedes on nothing`,
          ).toContain(view.dedup.versionColumn);
        }
      }
    });

    /**
     * The time column is what the schema endpoint tells a caller to filter on
     * to prune partitions. If it is not the column the table partitions by,
     * that advice makes queries slower rather than faster.
     */
    /** @scenario "Every LangWatchQL view names the column that prunes its partitions" */
    it("names a time column the source table actually partitions by", async () => {
      // Only the ClickHouse-resident half: a PostgreSQL-engine table has no
      // partitions, and its time column earns its keep a different way — a
      // predicate on it is pushed down to the primary as an index-usable one.
      for (const view of LWQL_VIEW_CATALOG.filter(
        (candidate) => !isPostgresResident(candidate),
      )) {
        const partitionKey = await selectScalar<string>(
          harness.admin,
          `SELECT partition_key AS value FROM system.tables ` +
            `WHERE database = '${facts}' AND name = '${view.sourceTable}'`,
        );
        expect(
          partitionKey,
          `${view.sourceTable} is not partitioned — pruning advice would be nonsense`,
        ).not.toBe("");
        expect(
          partitionKey.includes(view.timeColumn),
          `${view.name} advertises ${view.timeColumn} but ${view.sourceTable} partitions by ${partitionKey}`,
        ).toBe(true);
      }
    });
  });

  describe("when the restricted identity reads a LangWatchQL view", () => {
    /** @scenario "Restricted identity with a valid key context reads only its own tenant's rows" */
    /** @scenario "A LangWatchQL view returns only the calling tenant's rows" */
    it("returns its own tenant's rows and none of the other tenant's, for every view", async () => {
      for (const view of LWQL_VIEW_CATALOG) {
        await recordSeedControl({
          harness,
          table: view.sourceTable,
          // A PostgreSQL-engine table sits in the LangWatchQL database, which is
          // `recordSeedControl`'s default; only the fact tables live elsewhere.
          ...(isPostgresResident(view) ? {} : { database: facts }),
          tenantColumn: "TenantId",
        });
        const rows = await selectRows<{ TenantId: string }>(
          tenantA,
          `SELECT DISTINCT TenantId FROM ${database}.${view.name}`,
        );
        expectOnlyTenantA({
          rows,
          tenantColumn: "TenantId",
          harness,
          context: `${view.name} view`,
        });
      }
    });

    /** @scenario "Garbage key context yields zero rows, never all rows" */
    it("returns zero rows through the views for a garbage key context", async () => {
      const control = await recordSeedControl({
        harness,
        table: "trace_summaries",
        database: facts,
        tenantColumn: "TenantId",
      });
      const garbage = await harness.restrictedClient({
        keyHash: "not-a-real-key-hash",
      });
      for (const view of LWQL_VIEW_CATALOG) {
        const count = await selectScalar<string>(
          garbage,
          `SELECT count() AS value FROM ${database}.${view.name}`,
        );
        expect(
          Number(count),
          `${view.name} answered a garbage key while ${control.tenantA + control.tenantB} trace rows exist`,
        ).toBe(0);
      }
    });

    /** @scenario "A caller that sends no tenant context at all reads nothing" */
    it("returns zero rows through the views when no tenant setting is sent", async () => {
      await recordSeedControl({
        harness,
        table: "trace_summaries",
        database: facts,
        tenantColumn: "TenantId",
      });
      const anonymous = await harness.restrictedClient();
      const count = await selectScalar<string>(
        anonymous,
        `SELECT count() AS value FROM ${database}.traces`,
      );
      expect(Number(count)).toBe(0);
    });

    /**
     * The negative control for the whole file. The policy sits on the *source*
     * table, not on the view, so detaching it there is what proves the view is
     * bounded by it rather than by anything in the view's own text.
     */
    /** @scenario "Detaching the row policy makes the other tenant's rows visible" */
    it("exposes the other tenant through the view once the source table's policy is detached", async () => {
      const [sourceTable] = lwqlSourceTables({
        names: harness.names,
        sourceDatabase: facts,
        views: LWQL_VIEW_CATALOG.filter(
          (view) => view.name === "simulations",
        ),
      });
      // Before the try, because the `finally` reattaches the policy using this
      // same entry: a catalog rename would otherwise throw inside the try and
      // then throw again while restoring, masking the first failure and leaving
      // the source table unpoliced for every case after this one.
      if (!sourceTable) {
        throw new Error(
          `lwql views suite: "simulations" is not in the shipped catalog, so there is no source table to detach a policy from`,
        );
      }

      let tenantsWithoutPolicy: string[] = [];
      try {
        await harness.applyAsAdmin([
          dropLangWatchQLRowPolicyStatement({
            names: harness.names,
            table: sourceTable.table,
            database: facts,
          }),
        ]);
        tenantsWithoutPolicy = (
          await selectRows<{ TenantId: string }>(
            tenantA,
            `SELECT DISTINCT TenantId FROM ${database}.simulations ORDER BY TenantId`,
          )
        ).map((row) => row.TenantId);
      } finally {
        await harness.applyAsAdmin([
          lwqlRowPolicyStatement({
            names: harness.names,
            lwqlTable: sourceTable,
          }),
        ]);
      }

      expect(
        tenantsWithoutPolicy,
        "detaching the source table's policy changed nothing — it is not what bounds the view",
      ).toEqual([harness.tenantA.tenantId, harness.tenantB.tenantId]);

      const restored = await selectRows<{ TenantId: string }>(
        tenantA,
        `SELECT DISTINCT TenantId FROM ${database}.simulations`,
      );
      expect(
        restored.map((row) => row.TenantId),
        "the policy was not restored, later tests would run unprotected",
      ).toEqual([harness.tenantA.tenantId]);
    });

    /**
     * The views are `INVOKER`, so the caller necessarily holds grants on the
     * physical tables. Those reads must be policed too — the gateway's table
     * allowlist is what keeps the physical name unwritable, and it is not the
     * thing being trusted here.
     */
    /** @scenario "Reading the physical fact table directly is policed the same way" */
    it("scopes a direct read of the source table to the calling tenant", async () => {
      const control = await recordSeedControl({
        harness,
        table: "trace_summaries",
        database: facts,
        tenantColumn: "TenantId",
      });
      expect(control.tenantB).toBeGreaterThan(0);

      const rows = await selectRows<{ TenantId: string }>(
        tenantA,
        `SELECT DISTINCT TenantId FROM ${facts}.trace_summaries`,
      );
      expect(rows.map((row) => row.TenantId)).toEqual([
        harness.tenantA.tenantId,
      ]);
    });
  });

  describe("when a source table holds two versions of one row", () => {
    /** @scenario "A LangWatchQL view returns one row per logical record, the latest version" */
    it("returns one row through the view, carrying the newer version's values", async () => {
      const traceId = dedupTraceId(harness.tenantA.tenantId);

      // The control: without it, "the view returned one row" is satisfied by a
      // table that only ever held one.
      const versions = await selectRows<{ SpanCount: number }>(
        harness.admin,
        `SELECT SpanCount FROM ${facts}.trace_summaries ` +
          `WHERE TenantId = '${harness.tenantA.tenantId}' AND TraceId = '${traceId}'`,
      );
      expect(
        versions.length,
        "the source table holds one version — a view that does not deduplicate would pass this",
      ).toBe(2);

      const deduped = await selectRows<{ SpanCount: number }>(
        tenantA,
        `SELECT SpanCount FROM ${database}.traces WHERE TraceId = '${traceId}'`,
      );
      expect(deduped).toHaveLength(1);
      expect(
        Number(deduped[0]!.SpanCount),
        "the view returned the stale version",
      ).toBe(DEDUP_FIXTURE.latestSpanCount);
    });

    /**
     * The version that moved partitions: the case a dedup shape can get wrong
     * without ever returning a duplicate. `OccurredAt` is a business time a
     * later fold can move, so a collapse that happens per partition — or a
     * `max()` scope carrying a time range — answers with the older version and
     * looks perfectly healthy.
     */
    /** @scenario "A LangWatchQL view returns one row per logical record, the latest version" */
    it("returns the newer version when it moved to another partition", async () => {
      const traceId = movedPartitionTraceId(harness.tenantA.tenantId);
      const raw = await selectRows<{ SpanCount: number; partition: string }>(
        harness.admin,
        `SELECT SpanCount, _partition_id AS partition FROM ${facts}.trace_summaries ` +
          `WHERE TenantId = '${harness.tenantA.tenantId}' AND TraceId = '${traceId}'`,
      );
      expect(raw).toHaveLength(2);
      expect(
        new Set(raw.map((row) => row.partition)).size,
        "both versions landed in the same partition — this case is not being exercised",
      ).toBe(2);

      const deduped = await selectRows<{ SpanCount: number }>(
        tenantA,
        `SELECT SpanCount FROM ${database}.traces WHERE TraceId = '${traceId}'`,
      );
      expect(deduped).toHaveLength(1);
      expect(
        Number(deduped[0]!.SpanCount),
        "the view collapsed within a partition and returned the stale version",
      ).toBe(MOVED_PARTITION_FIXTURE.latestSpanCount);
    });

    /**
     * The version whose *sort key* moved: the case `FINAL` cannot answer at all,
     * because it merges on the source's `ORDER BY` and the two versions no
     * longer share one. `evaluation_analytics` folds its progress watermark into
     * `OccurredAt`, which is second in that key, so this is the ordinary shape
     * of an evaluation that received a second lifecycle event rather than an
     * edge case — and the failure it produces is not a visible duplicate but
     * every aggregate over the dataset counting the evaluation twice.
     */
    /** @scenario "A dataset whose sort key moves is deduplicated by its own identity" */
    it("returns one row for a record whose two versions carry two sort keys", async () => {
      const evaluationId = evaluationDedupId(harness.tenantA.tenantId);

      // The control, on the physical table: two rows, under two sort keys, in
      // two partitions. Without it a view that deduplicates nothing passes,
      // because there would have been one row all along.
      const versions = await selectRows<{
        Score: number;
        OccurredAt: string;
        partition: string;
      }>(
        harness.admin,
        `SELECT Score, OccurredAt, _partition_id AS partition FROM ${facts}.evaluation_analytics ` +
          `WHERE TenantId = '${harness.tenantA.tenantId}' AND EvaluationId = '${evaluationId}'`,
      );
      expect(
        versions.length,
        "the source table holds one version — a view that does not deduplicate would pass this",
      ).toBe(2);
      expect(
        new Set(versions.map((row) => row.OccurredAt)).size,
        "both versions carry the same OccurredAt, so they share a sort key and this case is not being exercised",
      ).toBe(2);
      expect(
        new Set(versions.map((row) => row.partition)).size,
        "both versions landed in the same partition — the cross-partition half is not being exercised",
      ).toBe(2);

      const deduped = await selectRows<{ Score: number; DurationMs: string }>(
        tenantA,
        `SELECT Score, DurationMs FROM ${database}.evaluation_metrics ` +
          `WHERE EvaluationId = '${evaluationId}'`,
      );
      expect(
        deduped,
        "the view returned both versions, so every count, sum and average over this dataset double-counts",
      ).toHaveLength(1);
      expect(
        Number(deduped[0]!.Score),
        "the view returned the stale version",
      ).toBeCloseTo(EVALUATION_DEDUP_FIXTURE.latestScore);
      expect(Number(deduped[0]!.DurationMs)).toBe(
        EVALUATION_DEDUP_FIXTURE.latestDurationMs,
      );
    });

    /**
     * The same claim for every view, stated as a count: one row per record. A
     * duplicate here silently doubles every aggregate a caller writes, which is
     * the failure mode nobody notices.
     *
     * Grouped by the dataset's grain rather than by its source's sort key —
     * grouping by the key the engine collapses on would ask each view whether it
     * did what the engine already does, which is a question no view can fail.
     */
    /** @scenario "A LangWatchQL view returns one row per logical record, the latest version" */
    it("returns exactly one row per record for every view", async () => {
      for (const view of LWQL_VIEW_CATALOG) {
        const keys = lwqlGrainColumns(view).join(", ");
        const duplicated = await selectScalar<string>(
          tenantA,
          `SELECT count() AS value FROM (` +
            `SELECT ${keys}, count() AS versions FROM ${database}.${view.name} ` +
            `GROUP BY ${keys} HAVING versions > 1)`,
        );
        expect(
          Number(duplicated),
          `${view.name} returns more than one row for some key`,
        ).toBe(0);
      }
    });
  });

  /**
   * The rollups (issue #6856). An `AggregatingMergeTree` holds a bucket as
   * however many partial rows the writers produced, and no one of them is the
   * answer — which makes it the one shape where "returned a single row" and
   * "returned the right number" can come apart.
   */
  describe("when a rollup table holds two partial rows for one bucket", () => {
    /**
     * Read back measure by measure, over every measure the catalog declares,
     * against totals no two of which are the same number. Both halves are
     * load-bearing: a bucket whose measures share a value is a bucket where
     * `TraceCount` reading `SpanCount` returns exactly what the assertion
     * expects, and a case that checks four of eleven measures is a case a
     * mislabelled twelfth walks straight past.
     */
    /** @scenario "A pre-aggregated dataset returns one merged row per bucket" */
    it("returns one merged row, each measure the sum of its own column's parts", async () => {
      for (const [name, filter, parts, totals] of [
        // The grouped rollup: no Model/SpanType columns to filter on, so the
        // bucket is isolated by its own grain. The fixture's bucket sits at
        // minute :01, which no weekly seed row occupies.
        [
          "trace_metrics_by_minute",
          `BucketStart = '${ROLLUP_MERGE_FIXTURE.bucketStart}'`,
          ROLLUP_MERGE_FIXTURE.traceParts,
          ROLLUP_MERGE_TOTALS.trace,
        ],
        [
          "model_usage_by_minute",
          `Model = '${ROLLUP_MERGE_FIXTURE.model}'`,
          ROLLUP_MERGE_FIXTURE.traceParts,
          ROLLUP_MERGE_TOTALS.modelUsage,
        ],
        [
          "evaluation_metrics_by_minute",
          `EvaluatorType = '${ROLLUP_MERGE_FIXTURE.evaluatorType}'`,
          ROLLUP_MERGE_FIXTURE.evaluationParts,
          ROLLUP_MERGE_TOTALS.evaluation,
        ],
      ] as const) {
        const view = LWQL_VIEW_CATALOG.find(
          (entry) => entry.name === name,
        )!;
        const measures = view.columns.filter((column) => column.summed);
        const expected = totals;

        // The fixture's own controls, before it is trusted to prove anything.
        // Every measure has a total, so a measure added to the catalog cannot
        // be silently unchecked; and no two totals are equal, so a view that
        // read one measure out of another's column reports a number that
        // belongs to something else.
        expect(
          measures.map((column) => column.name).sort(),
          `${name} declares a measure the merge fixture states no total for`,
        ).toEqual(Object.keys(expected).sort());
        expect(
          new Set(Object.values(expected)).size,
          `${name}'s totals repeat a value, so swapping those two measures would pass`,
        ).toBe(Object.values(expected).length);

        // The control on the physical table: without it a view that merges
        // nothing passes, because the bucket would have been one row all along.
        const stored = await selectScalar<string>(
          harness.admin,
          `SELECT count() AS value FROM ${facts}.${view.sourceTable} ` +
            `WHERE TenantId = '${harness.tenantA.tenantId}' AND ${filter}`,
        );
        expect(
          Number(stored),
          `the ${name} bucket is stored as one row — a view that does not merge would pass this`,
        ).toBe(parts.length);

        const merged = await selectRows<Record<string, string | number>>(
          tenantA,
          `SELECT ${measures.map((column) => column.name).join(", ")} ` +
            `FROM ${database}.${name} WHERE ${filter}`,
        );
        expect(merged, `${name} did not merge the bucket`).toHaveLength(1);

        for (const column of measures) {
          const actual = Number(merged[0]![column.name]);
          const total = expected[column.name]!;
          const where = `${name}.${column.name} is ${actual}, the parts add up to ${total}`;
          // A float measure is compared approximately and an integer one
          // exactly, because an integer measure landing near its total rather
          // than on it is a real failure.
          if (column.type.startsWith("Float")) {
            expect(actual, where).toBeCloseTo(total);
          } else {
            expect(actual, where).toBe(total);
          }
        }
      }
    });

    /**
     * The published type, not the storage engine's. A rollup measure is stored
     * as `SimpleAggregateFunction(sum, …)`, which a view passes straight
     * through to `system.columns` and therefore to the schema endpoint — a
     * caller would be told the name of an engine instead of a number's type.
     */
    /** @scenario "A pre-aggregated dataset returns one merged row per bucket" */
    it("publishes the measures as plain numeric types", async () => {
      const stored = await selectScalar<string>(
        harness.admin,
        `SELECT type AS value FROM system.columns ` +
          `WHERE database = '${facts}' AND table = 'trace_analytics_rollup' ` +
          `AND name = 'SpanCount'`,
      );
      expect(
        stored,
        "the source no longer stores an aggregate function — this case is inspecting nothing",
      ).toContain("SimpleAggregateFunction");

      const published = await selectScalar<string>(
        harness.admin,
        `SELECT type AS value FROM system.columns ` +
          `WHERE database = '${database}' AND table = 'trace_metrics_by_minute' ` +
          `AND name = 'SpanCount'`,
      );
      expect(published).toBe("UInt64");
    });
  });

  describe("when the restricted identity names a column outside the catalog", () => {
    /** @scenario "A column no LangWatchQL view exposes is unreachable, not merely unselected" */
    it("is refused by the database, while a catalog column reads", async () => {
      const inCatalog = await selectScalar<string>(
        tenantA,
        `SELECT count() AS value FROM ${facts}.trace_summaries WHERE TraceId != ''`,
      );
      expect(
        Number(inCatalog),
        "a granted column did not read — the denial below would not be about the grant",
      ).toBeGreaterThan(0);

      await expectClickHouseError(
        () =>
          selectRows(
            tenantA,
            `SELECT ${OFF_CATALOG_COLUMN} FROM ${facts}.trace_summaries LIMIT 1`,
          ),
        CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
        `off-catalog column ${OFF_CATALOG_COLUMN}`,
      );

      // The free-text carriers the catalog deliberately omits, each of which
      // would be a content side-channel with no gate in the visibility policy.
      for (const [table, column] of [
        ["trace_summaries", "ErrorMessage"],
        ["evaluation_runs", "Error"],
        ["stored_spans", "StatusMessage"],
        ["stored_spans", "Events.Attributes"],
      ] as const) {
        await expectClickHouseError(
          () =>
            selectRows(
              tenantA,
              `SELECT \`${column}\` FROM ${facts}.${table} LIMIT 1`,
            ),
          CLICKHOUSE_ERROR_CODE.ACCESS_DENIED,
          `off-catalog column ${table}.${column}`,
        );
      }
    });
  });

  describe("when captured content is reached through a LangWatchQL view", () => {
    /** @scenario "Captured content is reachable only through the gated columns" */
    it("strips every content key from the attribute maps while keeping the dimensions", async () => {
      const row = await selectRows<{
        span: Record<string, string>;
        resource: Record<string, string>;
        trace: Record<string, string>;
      }>(
        tenantA,
        `SELECT s.SpanAttributes AS span, s.ResourceAttributes AS resource, t.Attributes AS trace ` +
          `FROM ${database}.spans AS s ` +
          `INNER JOIN ${database}.traces AS t ON t.TraceId = s.TraceId ` +
          `LIMIT 1`,
      );
      expect(
        row,
        "no joined row to inspect — the absence checks below would be vacuous",
      ).toHaveLength(1);
      const { span, resource, trace } = row[0]!;

      expect(
        span[SEEDED_DIMENSION_ATTRIBUTE.key],
        "the filter removed a dimension along with the content",
      ).toBe(SEEDED_DIMENSION_ATTRIBUTE.value);

      const serialised = JSON.stringify({ span, resource, trace });
      for (const [label, leaked] of Object.entries(SEEDED_CONTENT)) {
        expect(
          serialised.includes(leaked),
          `${label} reached the caller through an attribute map`,
        ).toBe(false);
      }
      for (const key of CONTENT_CATEGORIES.flatMap(
        (category) => CONTENT_KEY_CATALOG[category],
      )) {
        expect(
          Object.keys(span).concat(Object.keys(trace)),
          `the content key ${key} survived the filter`,
        ).not.toContain(key);
      }
    });

    /**
     * The other half of the same claim: content is *reachable*, through the
     * gated columns and only there. Without this, a view that returned nothing
     * at all would pass the check above.
     */
    /** @scenario "Captured content is reachable only through the gated columns" */
    it("returns the captured content through the gated columns", async () => {
      const [trace] = await selectRows<{
        CapturedInput: string;
        CapturedOutput: string;
      }>(
        tenantA,
        `SELECT CapturedInput, CapturedOutput FROM ${database}.traces LIMIT 1`,
      );
      expect(trace!.CapturedInput).toContain(SEEDED_CONTENT.traceInput);
      expect(trace!.CapturedOutput).toContain(SEEDED_CONTENT.traceOutput);

      const [span] = await selectRows<{
        CapturedInput: string;
        CapturedOutput: string;
      }>(
        tenantA,
        `SELECT CapturedInput, CapturedOutput FROM ${database}.spans LIMIT 1`,
      );
      expect(span!.CapturedInput).toBe(SEEDED_CONTENT.spanInput);
      expect(span!.CapturedOutput).toBe(SEEDED_CONTENT.spanOutput);
    });

    /**
     * The scenario's two halves in one place: the gated set is derived from the
     * canonical visibility policy, and the shipped validator refuses a member
     * of that set in each of the eight expression positions the policy
     * enumerates.
     */
    /** @scenario "Content-gated fields are refused in every expression position" */
    it("refuses a gated field in every expression position, over the canonical gated set", () => {
      const withoutContent = lwqlGatedColumns({
        protections: {
          canSeeCapturedInput: false,
          canSeeCapturedOutput: false,
          canSeeCosts: true,
        },
        views: LWQL_VIEW_CATALOG,
      });
      const contentColumns = LWQL_VIEW_CATALOG.flatMap((view) =>
        view.columns.filter(isContentGated).map((column) => column.name),
      );
      expect(
        [...new Set(contentColumns)].sort(),
        "the gated set a caller without content permission gets is not the catalog's content columns",
      ).toEqual([...withoutContent]);
      expect(withoutContent).toContain("CapturedInput");

      // Every gate the catalog names is one the canonical policy defines.
      const canonicalGates = new Set(["input", "output", "costs"]);
      for (const view of LWQL_VIEW_CATALOG) {
        for (const column of view.columns) {
          for (const gate of column.gates) {
            expect(
              canonicalGates.has(gate),
              `${view.name}.${column.name} names a gate the visibility policy does not define`,
            ).toBe(true);
          }
        }
      }

      const policy = {
        allowedTables: lwqlAllowedTables({
          database,
          views: LWQL_VIEW_CATALOG,
        }),
        gatedColumns: withoutContent,
        defaultDatabase: database,
      };
      for (const [position, sql] of GATED_COLUMN_POSITIONS(database)) {
        const result = validateLangWatchQL({ sql, ...policy });
        expect(result.ok, `${position}: a gated field was accepted`).toBe(
          false,
        );
        expect(
          result.ok ? [] : result.violations.map((violation) => violation.code),
          `${position}: refused for the wrong reason`,
        ).toContain("GATED_COLUMN");
      }

      // The same queries pass for a caller who holds the permission, so the
      // refusals above are about the gate rather than about the SQL.
      const permitted = {
        ...policy,
        gatedColumns: lwqlGatedColumns({
          protections: {
            canSeeCapturedInput: true,
            canSeeCapturedOutput: true,
            canSeeCosts: true,
          },
          views: LWQL_VIEW_CATALOG,
        }),
      };
      expect(
        permitted.gatedColumns,
        "a caller holding every permission still has fields withheld",
      ).toEqual([]);
      for (const [position, sql] of GATED_COLUMN_POSITIONS(database)) {
        expect(
          validateLangWatchQL({ sql, ...permitted }).ok,
          `${position}: refused a permitted caller, so the refusal is not the gate`,
        ).toBe(true);
      }
    });
  });

  describe("when the LangWatchQL database's own definitions are audited", () => {
    /** @scenario "Every LangWatchQL object has an effective row policy" */
    it("covers every object the restricted identity can read, in every database", async () => {
      const coverage = await selectRows<{
        database: string;
        table: string;
        has_policy: number;
        is_invoker_view: number;
        covered: number;
      }>(harness.admin, lwqlPolicyCoverageQuery({ names: harness.names }));

      expect(
        coverage.length,
        "no exposed objects found — the coverage check would certify nothing",
      ).toBeGreaterThan(0);
      expect(
        coverage
          .filter((row) => Number(row.covered) !== 1)
          .map((row) => `${row.database}.${row.table}`),
        "LangWatchQL objects are readable with nothing scoping them to a tenant",
      ).toEqual([]);

      // The audit must be looking at both halves: the views, and the physical
      // tables under them. A query that only saw one would still read clean.
      const audited = coverage.map((row) => `${row.database}.${row.table}`);
      const sources = lwqlSourceTables({
        names: harness.names,
        sourceDatabase: facts,
      });
      for (const view of LWQL_VIEW_CATALOG) {
        expect(audited).toContain(`${database}.${view.name}`);
      }
      // The source tables live in two databases — the migrated fact tables in
      // one, the PostgreSQL-engine tables beside the views in the other — so
      // where to look for each comes from the catalog rather than being assumed.
      for (const source of sources) {
        expect(audited).toContain(
          `${source.database ?? database}.${source.table}`,
        );
      }
      const physical = new Set(
        sources.map(
          (source) => `${source.database ?? database}.${source.table}`,
        ),
      );
      for (const row of coverage.filter((entry) =>
        physical.has(`${entry.database}.${entry.table}`),
      )) {
        expect(
          Number(row.has_policy),
          `${row.table} is a physical table with no row policy`,
        ).toBe(1);
      }
    });

    /** @scenario "A definer-rights view bypasses the row policy and is reported by the audit" */
    it("reports no definer-rights or materialized view in the LangWatchQL database", async () => {
      const flagged = await selectRows(
        harness.admin,
        definerViewAuditQuery({ names: harness.names }),
      );
      expect(
        flagged,
        "a LangWatchQL view reads as its definer, so row policies do not apply to it",
      ).toEqual([]);
    });

    /**
     * The policies are attached `TO` the restricted identity, so nothing else
     * on the server may be narrowed by them. Asserted from the administrator's
     * side, because "the application still works" is otherwise something we
     * would find out in production.
     */
    /** @scenario "Row policies leave the application's own reads untouched" */
    it("leaves an administrative read of the fact tables unscoped", async () => {
      // Only the ClickHouse-resident sources: a PostgreSQL-engine table's rows
      // come from a relation the whole application also reads, and this case is
      // about the policies this module creates not reaching the administrator.
      for (const view of LWQL_VIEW_CATALOG.filter(
        (candidate) => !isPostgresResident(candidate),
      )) {
        const tenants = await selectRows<{ TenantId: string }>(
          harness.admin,
          `SELECT DISTINCT TenantId FROM ${facts}.${view.sourceTable} ORDER BY TenantId`,
        );
        expect(
          tenants.map((row) => row.TenantId),
          `${view.sourceTable} is narrowed for the administrator too`,
        ).toEqual([harness.tenantA.tenantId, harness.tenantB.tenantId]);
      }
    });
  });

  describe("when a caller's time predicate is applied through a view", () => {
    /**
     * The measurement that chose {@link SHIPPED_LWQL_DEDUP}.
     *
     * `read_rows` from the server's own accounting, because that is the number
     * partition pruning moves. A dedup shape whose filtered read costs the same
     * as its unfiltered one is a full history scan per query however fast it
     * looks on a seeded container.
     */
    /** @scenario "A time predicate on a LangWatchQL view prunes partitions" */
    it("prunes partitions, and each dedup strategy's cost is recorded", async () => {
      const view = LWQL_VIEW_CATALOG.find(
        (entry) => entry.name === "traces",
      );
      // Before the try, because the `finally` below re-applies the shipped view
      // using this same entry: a catalog rename would otherwise throw inside
      // the try and then throw again while restoring, masking the first
      // failure and leaving the view mis-shaped for every case after this one.
      if (!view) {
        throw new Error(
          `lwql views suite: "traces" is not in the shipped catalog, so there is no view to measure dedup strategies on`,
        );
      }
      const unfiltered = `SELECT count() AS value FROM ${database}.traces`;
      const filtered =
        `SELECT count() AS value FROM ${database}.traces ` +
        `WHERE OccurredAt >= toDateTime64('${SEED_RECENT_WEEK.from}', 3) ` +
        `AND OccurredAt < toDateTime64('${SEED_RECENT_WEEK.to}', 3)`;

      const strategies = [
        "none",
        "in-tuple",
        "final",
      ] satisfies LangWatchQLDedupStrategy[];

      // `Partial`, because that is what it is until the loop finishes. Declared
      // as fully-populated it would have typed every read below as present
      // while a loop that threw part-way left them `undefined`, and the
      // assertions would then have compared `undefined` to `undefined`.
      const measured: Partial<
        Record<
          LangWatchQLDedupStrategy,
          { unfilteredRows: number; filteredRows: number; rows: number }
        >
      > = {};

      try {
        for (const strategy of strategies) {
          await harness.applyAsAdmin([
            lwqlViewStatement({
              names: harness.names,
              sourceDatabase: facts,
              view,
              dedup: strategy,
            }),
          ]);
          const withoutFilter = await measureQuery({
            harness,
            client: tenantA,
            query: unfiltered,
          });
          const withFilter = await measureQuery({
            harness,
            client: tenantA,
            query: filtered,
          });
          measured[strategy] = {
            unfilteredRows: withoutFilter.rowsRead,
            filteredRows: withFilter.rowsRead,
            rows: Number(await selectScalar<string>(tenantA, unfiltered)),
          };
        }
      } finally {
        await applyShippedViews();
      }

      // Carried in every assertion message rather than only logged: vitest's
      // default reporter swallows a passing test's stdout, and a measurement
      // nobody can read is not a measurement.
      const report = JSON.stringify(measured);

      // The comparisons below are only a comparison if all three ran. Proven
      // here rather than assumed by the type, so a strategy the loop never
      // reached fails as itself instead of as an unreadable `undefined`.
      for (const strategy of strategies) {
        expect(
          measured[strategy],
          `${strategy} was never measured, so the comparisons below compare nothing. ${report}`,
        ).toBeDefined();
      }

      expect(
        measured.none!.rows,
        `the undeduplicated view returned no more rows than the deduplicated one — nothing to collapse. ${report}`,
      ).toBeGreaterThan(measured[SHIPPED_LWQL_DEDUP]!.rows);

      // The property that chose the strategy. `in-tuple` fails it: its `max()`
      // subquery carries no predicate from the caller's query, so it reads the
      // tenant's whole history however narrow the time filter is, and the
      // filtered read costs *more* than the undeduplicated unfiltered one.
      expect(
        measured[SHIPPED_LWQL_DEDUP]!.filteredRows,
        `the shipped dedup (${SHIPPED_LWQL_DEDUP}) reads as much for one week as for the whole history. ${report}`,
      ).toBeLessThan(measured[SHIPPED_LWQL_DEDUP]!.unfilteredRows / 2);

      // Deduplication must cost nothing a plain read would not: the shipped
      // shape reads no more than the strategy that does not deduplicate at all.
      expect(
        measured[SHIPPED_LWQL_DEDUP]!.filteredRows,
        `deduplicating costs more than reading undeduplicated. ${report}`,
      ).toBeLessThanOrEqual(measured.none!.filteredRows);
    }, 300_000);
  });
});
