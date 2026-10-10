import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  collectClickhouseOwnershipFindings,
  DECLARED_OWNERSHIP,
  type DeclaredOwnership,
} from "../src/policies/persistence/clickhouse-table-ownership.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";

/**
 * @see packages/architecture-enforcer/specs/clickhouse-ownership-records.feature
 */

const roots: string[] = [];

const CATALOGUE: FeatureCatalogueEntry[] = [
  { id: "trace", root: "modules/trace", classification: "core", subjects: ["trace"] },
  { id: "analytics", root: "modules/analytics", classification: "core", subjects: ["analytics"] },
  {
    id: "experiment",
    root: "modules/experiment",
    classification: "core",
    subjects: ["experiment"],
  },
  {
    id: "instant-eval",
    root: "modules/instant-eval",
    classification: "core",
    subjects: ["instant-eval"],
  },
];

const SUBQUERY_FILE =
  "modules/trace/process/src/features/query/rules/trace-query-subquery.rules.ts";

const DECLARED: DeclaredOwnership = {
  records: [
    {
      table: "event_log",
      owner: "framework",
      writer: "packages/eventing",
      reason: "the event store",
    },
    { table: "stored_objects", owner: "legacy", writer: "none", reason: "read-only index" },
  ],
  exceptions: [
    {
      reader: "trace",
      table: "instant_eval_judgments",
      file: SUBQUERY_FILE,
      reason: "one statement",
    },
  ],
  shared: [
    { table: "trace_analytics", owner: "trace", readers: ["analytics"], reason: "dashboards" },
  ],
};

const ANALYTICS_READER =
  "modules/analytics/process/src/repositories/clickhouse/clickhouse.slim.mapper.ts";

function create(table: string): string {
  return `-- +goose Up\nCREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.${table} (TenantId String) ENGINE = MergeTree;\n`;
}

function writer(table: string): string {
  return `export async function store(client: { insert: (options: unknown) => Promise<void> }) {
  await client.insert({ table: "${table}", values: [], format: "JSONEachRow" });
}
`;
}

function reader(table: string): string {
  return `export function query(): string {
  return \`SELECT TenantId FROM ${table} WHERE TenantId = {tenantId:String}\`;
}
`;
}

function fixture(declared: DeclaredOwnership = DECLARED) {
  const root = mkdtempSync(join(tmpdir(), "clickhouse-records-"));
  roots.push(root);
  const write = (file: string, content: string) => {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  write("packages/clickhouse-migrations/migrations/00001_event_log.sql", create("event_log"));
  write(
    "packages/clickhouse-migrations/migrations/00002_stored_objects.sql",
    create("stored_objects"),
  );
  write(
    "packages/clickhouse-migrations/migrations/00003_judgments.sql",
    create("instant_eval_judgments"),
  );
  write(
    "modules/instant-eval/process/src/repositories/clickhouse/clickhouse.judgments.repository.ts",
    writer("instant_eval_judgments"),
  );
  write(SUBQUERY_FILE, reader("instant_eval_judgments"));
  write(
    "packages/clickhouse-migrations/migrations/00004_trace_analytics.sql",
    create("trace_analytics"),
  );
  write(
    "modules/trace/process/src/repositories/clickhouse/clickhouse.trace-analytics.repository.ts",
    writer("trace_analytics"),
  );
  write(ANALYTICS_READER, reader("trace_analytics"));

  return {
    write,
    messages: () =>
      collectClickhouseOwnershipFindings(root, CATALOGUE, declared).map((item) => item.message),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ClickHouse ownership records", () => {
  describe("given tables no module writes", () => {
    /** @scenario "A table recorded as framework owned is not an ownerless table" */
    it("reports no ownerless event_log once it is recorded", () => {
      expect(fixture().messages()).not.toContain("Table event_log has no module owner.");
      expect(fixture({ ...DECLARED, records: [] }).messages()).toContain(
        "Table event_log has no module owner.",
      );
    });

    /** @scenario "A table recorded as legacy owned is not an ownerless table" */
    it("reports no ownerless stored_objects once it is recorded", () => {
      expect(fixture().messages()).not.toContain("Table stored_objects has no module owner.");
    });
  });

  describe("given a module writes a recorded table", () => {
    /** @scenario "A module writing a recorded table is reported" */
    it("reports the module, the record and its reason", () => {
      const world = fixture();
      world.write(
        "modules/trace/process/src/repositories/clickhouse/clickhouse.events.repository.ts",
        writer("event_log"),
      );

      expect(world.messages()).toContain(
        "trace writes event_log, recorded as framework owned (packages/eventing: the event store).",
      );
    });
  });

  describe("given a record naming a table no migration creates", () => {
    /** @scenario "A record naming a table no migration creates is reported" */
    it("reports the stale record", () => {
      const declared: DeclaredOwnership = {
        ...DECLARED,
        records: [
          ...DECLARED.records,
          { table: "gone", owner: "legacy", writer: "none", reason: "x" },
        ],
      };

      expect(fixture(declared).messages()).toContain(
        "Table gone is recorded as legacy owned but no migration creates it. Delete the record.",
      );
    });
  });

  describe("given trace reads another module's table inside one statement", () => {
    /** @scenario "A declared one-statement subquery passes" */
    it("reports nothing for the declared reader, table and file", () => {
      expect(fixture().messages()).toEqual([]);
    });

    /** @scenario "An undeclared foreign read still fails" */
    it("reports the same read from a file the exception does not name", () => {
      const world = fixture();
      world.write(
        "modules/trace/process/src/repositories/clickhouse/clickhouse.other.repository.ts",
        reader("instant_eval_judgments"),
      );

      expect(world.messages()).toEqual([
        "trace reads instant_eval_judgments, owned by instant-eval.",
      ]);
    });

    /** @scenario "A named exception matching no read is reported" */
    it("reports an exception the tree no longer needs", () => {
      const declared: DeclaredOwnership = {
        ...DECLARED,
        exceptions: [
          ...DECLARED.exceptions,
          { reader: "trace", table: "stored_objects", file: "modules/trace/x.ts", reason: "x" },
        ],
      };

      expect(fixture(declared).messages()).toEqual([
        "The named exception for trace reading stored_objects in modules/trace/x.ts matches no read. Delete it.",
      ]);
    });
  });

  describe("given trace shares trace_analytics for reading with analytics", () => {
    /** @scenario "A module reading a table its owner shares with it passes" */
    it("reports nothing for the named reader", () => {
      expect(fixture().messages()).toEqual([]);
    });

    /** @scenario "A module the owner did not name still may not read a shared table" */
    it("reports a reader the declaration does not name", () => {
      const world = fixture();
      world.write(
        "modules/experiment/process/src/repositories/clickhouse/clickhouse.run.repository.ts",
        reader("trace_analytics"),
      );

      expect(world.messages()).toEqual(["experiment reads trace_analytics, owned by trace."]);
    });

    /** @scenario "A named reader writing a shared table is a second writer" */
    it("reports the named reader inserting into the table", () => {
      const world = fixture();
      world.write(
        "modules/analytics/process/src/repositories/clickhouse/clickhouse.writer.repository.ts",
        writer("trace_analytics"),
      );

      expect(world.messages()).toContain(
        "Table trace_analytics is written by trace and analytics (modules/analytics/process/src/repositories/clickhouse/clickhouse.writer.repository.ts). Keep a single module owner.",
      );
    });

    /** @scenario "A shared table declared by a module that does not own it is reported" */
    it("reports a declaration naming the wrong owner", () => {
      const declared: DeclaredOwnership = {
        ...DECLARED,
        shared: [{ table: "trace_analytics", owner: "analytics", readers: ["trace"], reason: "x" }],
      };

      expect(fixture(declared).messages()).toEqual([
        "analytics reads trace_analytics, owned by trace.",
        "Table trace_analytics is declared shared by analytics, which does not own it. Fix or delete the declaration.",
      ]);
    });

    /** @scenario "A shared reader that no longer reads the table is reported" */
    it("reports a named reader the tree no longer has", () => {
      const declared: DeclaredOwnership = {
        ...DECLARED,
        shared: [{ ...DECLARED.shared[0]!, readers: ["analytics", "experiment"] }],
      };

      expect(fixture(declared).messages()).toEqual([
        "Table trace_analytics is shared with experiment, which no longer reads it. Delete the reader.",
      ]);
    });
  });

  describe("given the declared records and exceptions", () => {
    /** @scenario "Every record and named exception carries a reason" */
    it("gives each one a reason", () => {
      const entries = [
        ...DECLARED_OWNERSHIP.records,
        ...DECLARED_OWNERSHIP.exceptions,
        ...DECLARED_OWNERSHIP.shared,
      ];

      expect(entries.filter((entry) => entry.reason.trim() === "")).toEqual([]);
      expect(DECLARED_OWNERSHIP.records.map((record) => record.table)).toEqual([
        "event_log",
        "stored_log_records",
        "stored_metric_records",
        "stored_objects",
        "automation_audit",
        "langy_messages",
      ]);
      expect(DECLARED_OWNERSHIP.exceptions).toHaveLength(3);
      expect(DECLARED_OWNERSHIP.shared.map((item) => item.table)).toEqual([
        "trace_analytics",
        "trace_analytics_rollup",
        "trace_summaries",
        "stored_spans",
        "evaluation_runs",
        "gateway_spend",
        "gateway_budget_ledger_events",
        "log_records",
        "instant_eval_runs",
      ]);
    });
  });
});
