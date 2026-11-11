/**
 * @vitest-environment node
 * The views pinned to latest-in-order return exactly the rows their FINAL form returned, over
 * versions, duplicates, a replay tie and versions in other partitions (analytics ADR-006).
 * @see specs/lwql/stock-widgets-read-no-map.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LangWatchQLViewProvisioningService } from "../../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import {
  LangWatchQLCatalogShapesService,
  type LangWatchQLViewDefinition,
} from "../../services/langwatch-ql-catalog-shapes.service.ts";
import {
  type LangWatchQLClickHouseHarness,
  startLangWatchQLClickHouse,
  TENANT_A,
} from "./lwql-clickhouse-harness.ts";
import { LATEST_IN_ORDER_VIEWS, provisionFinalTwins } from "./lwql-final-twins.ts";

const shapes = LangWatchQLCatalogShapesService.create();

const TENANT = TENANT_A.tenantId;
const DAY = 86_400_000;
/** Versions 40 days apart, so a version's partition column lands it in another partition. */
const BASE = Date.UTC(2026, 7, 1);
const timeOf = (n: number) =>
  new Date(BASE + n * 40 * DAY).toISOString().slice(0, 23).replace("T", " ");

type Column = { name: string; type: string; default_kind: string };
type Row = Record<string, unknown>;

const bare = (type: string) => type.replace(/^(?:LowCardinality|Nullable)\((.*)\)$/, "$1");
const bareType = (type: string) => bare(bare(type));
const isTime = (type: string) => bareType(type).startsWith("Date");

/** A value of the column's type: `n` picks which, the same `n` the same value. */
function valueOf({ column, n, text }: { column: Column; n: number; text: string }): unknown {
  const type = bareType(column.type);
  if (column.name === "TenantId") return TENANT;
  if (type.startsWith("DateTime64")) return timeOf(n);
  if (type.startsWith("DateTime")) return timeOf(n).slice(0, 19);
  if (type.startsWith("Date")) return timeOf(n).slice(0, 10);
  if (/^(?:U?Int|Float|Decimal)/.test(type)) return n;
  if (/^(?:Fixed)?String/.test(type)) return `${text}${n}`;
  if (type === "Bool") return false;
  throw new Error(`no seed value for ${column.name} ${column.type}`);
}

/** The columns a view groups by, versions by and breaks a version tie by. */
function dedupColumns(view: LangWatchQLViewDefinition) {
  const { keyColumns, versionColumn, tieBreakColumns = [], stableColumns = [] } = view.dedup;
  if (!versionColumn) throw new Error(`${view.name} pins latest-in-order with no version column`);
  const group = [
    ...new Set([...keyColumns.map((key) => shapes.physicalColumn(view, key)), ...stableColumns]),
  ];
  return { group, version: versionColumn, tieBreak: tieBreakColumns };
}

/**
 * Seeds one view's source table, one insert per version so each lands in its own part:
 * superseding versions, an exact duplicate, a replay that ties on the version and wins on the
 * tie-break, and a key whose time column moved, which the sort key keeps as two rows.
 */
async function seed({
  harness,
  view,
  columns,
  sortingKey,
}: {
  harness: LangWatchQLClickHouseHarness;
  view: LangWatchQLViewDefinition;
  columns: Column[];
  sortingKey: string[];
}): Promise<void> {
  const { group, version, tieBreak } = dedupColumns(view);
  const writable = columns.filter(
    (column) => column.default_kind !== "MATERIALIZED" && column.default_kind !== "ALIAS",
  );
  const byName = new Map(writable.map((column) => [column.name, column]));
  const deduping = new Set([...group, version, ...tieBreak]);
  const value = shapes
    .viewSourceColumns(view)
    .map((name) => byName.get(name))
    .find(
      (column) =>
        column && !deduping.has(column.name) && /^(?:Fixed)?String/.test(bareType(column.type)),
    );
  if (!value) throw new Error(`${view.name}: no text column to tell its versions apart`);

  const row = ({
    key,
    n,
    tie = n,
    text,
    moved = 0,
  }: {
    key: number;
    n: number;
    tie?: number;
    text: string;
    moved?: number;
  }): Row => {
    const fields: Row = {};
    // Unset times take the version's, so a time partition column moves with the version.
    for (const column of writable.filter((candidate) => isTime(candidate.type))) {
      fields[column.name] = valueOf({ column, n, text: "" });
    }
    for (const name of group) {
      const column = byName.get(name);
      if (!column) throw new Error(`${view.name}: ${name} is not a writable column`);
      fields[name] = valueOf({ column, n: isTime(column.type) ? moved : key, text: "key-" });
    }
    const versionColumn = byName.get(version);
    if (!versionColumn) throw new Error(`${view.name}: ${version} is not a writable column`);
    fields[version] = valueOf({ column: versionColumn, n, text: "v" });
    for (const name of tieBreak) {
      const column = byName.get(name);
      if (!column) throw new Error(`${view.name}: ${name} is not a writable column`);
      fields[name] = valueOf({ column, n: tie, text: "" });
    }
    fields[value.name] = text;
    return fields;
  };

  const inserts: Row[] = [
    row({ key: 1, n: 1, text: "first" }),
    row({ key: 1, n: 3, text: "latest" }),
    row({ key: 1, n: 2, text: "late arrival" }),
    row({ key: 2, n: 1, text: "duplicate" }),
    row({ key: 2, n: 1, text: "duplicate" }),
  ];
  if (tieBreak.length > 0) {
    inserts.push(row({ key: 3, n: 1, tie: 1, text: "before the replay" }));
    inserts.push(row({ key: 3, n: 1, tie: 2, text: "replayed" }));
  }
  const movable = group.find(
    (name) => sortingKey.includes(name) && isTime(byName.get(name)?.type ?? ""),
  );
  if (movable) {
    inserts.push(row({ key: 4, n: 1, text: "anchor", moved: 1 }));
    inserts.push(row({ key: 4, n: 2, text: "moved anchor", moved: 2 }));
  }
  for (const values of inserts) {
    await harness.admin.insert({
      table: `${harness.factDatabase}.${view.sourceTable}`,
      format: "JSONEachRow",
      values: [values],
    });
  }
}

describe("given the views pinned to latest-in-order and their FINAL twins", () => {
  let harness: LangWatchQLClickHouseHarness;
  let finalTwins: string;

  async function count(sql: string): Promise<number> {
    const result = await harness.admin.query({
      query: `SELECT count() AS n FROM (${sql})`,
      format: "JSONEachRow",
    });
    const [row] = await result.json<{ n: string }>();
    return Number(row?.n ?? Number.NaN);
  }

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "latest_in_order", facts: "migrated" });
    await harness.applyAsAdmin(
      LangWatchQLViewProvisioningService.create().setupStatements({
        names: harness.names,
        sourceDatabase: harness.factDatabase,
        views: LATEST_IN_ORDER_VIEWS,
        dedup: "final",
      }),
    );
    finalTwins = await provisionFinalTwins({ harness });

    for (const view of LATEST_IN_ORDER_VIEWS) {
      const columns = await harness.admin.query({
        query: `SELECT name, type, default_kind FROM system.columns WHERE database = {db:String} AND table = {table:String} ORDER BY position`,
        query_params: { db: harness.factDatabase, table: view.sourceTable },
        format: "JSONEachRow",
      });
      const table = await harness.admin.query({
        query: `SELECT sorting_key FROM system.tables WHERE database = {db:String} AND name = {table:String}`,
        query_params: { db: harness.factDatabase, table: view.sourceTable },
        format: "JSONEachRow",
      });
      const [source] = await table.json<{ sorting_key: string }>();
      // Unmerged parts keep every version apart, so the read, not a merge, does the dedup.
      await harness.applyAsAdmin([
        `SYSTEM STOP MERGES ${harness.factDatabase}.${view.sourceTable}`,
      ]);
      await seed({
        harness,
        view,
        columns: await columns.json<Column>(),
        sortingKey: source?.sorting_key.split(", ") ?? [],
      });
    }
  }, 600_000);

  afterAll(async () => {
    await harness?.stop();
  });

  /** @scenario "The latest-in-order views return the rows the FINAL views returned" */
  it.each(LATEST_IN_ORDER_VIEWS.map((view) => ({ view: view.name })))(
    "$view returns no row its FINAL twin does not, and misses none",
    async ({ view }) => {
      const latest = `SELECT * FROM ${harness.names.database}.${view}`;
      const final = `SELECT * FROM ${finalTwins}.${view}`;

      const rows = await count(latest);
      expect(rows).toBeGreaterThanOrEqual(2);
      expect({
        rows,
        onlyLatest: await count(`${latest} EXCEPT ${final}`),
        onlyFinal: await count(`${final} EXCEPT ${latest}`),
      }).toEqual({ rows: await count(final), onlyLatest: 0, onlyFinal: 0 });
    },
  );

  it("keeps the latest version, the replay and both rows of a moved anchor in trace_metrics", async () => {
    const result = await harness.admin.query({
      query:
        `SELECT TraceId, ConversationId FROM ${harness.names.database}.trace_metrics ` +
        `ORDER BY TraceId, OccurredAt`,
      format: "JSONEachRow",
    });

    expect(await result.json()).toEqual([
      { TraceId: "key-1", ConversationId: "latest" },
      { TraceId: "key-2", ConversationId: "duplicate" },
      { TraceId: "key-3", ConversationId: "replayed" },
      { TraceId: "key-4", ConversationId: "anchor" },
      { TraceId: "key-4", ConversationId: "moved anchor" },
    ]);
  });
});
