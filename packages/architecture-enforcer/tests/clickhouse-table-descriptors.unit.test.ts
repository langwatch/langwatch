import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clickhouseScanAt,
  collectClickhouseOwnershipFindings,
  type DeclaredOwnership,
} from "../src/policies/persistence/clickhouse-table-ownership.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";

/**
 * @see packages/architecture-enforcer/specs/clickhouse-table-descriptors.feature
 */

const roots: string[] = [];

const CATALOGUE: FeatureCatalogueEntry[] = [
  { id: "trace", root: "modules/trace", classification: "core", subjects: ["trace"] },
  { id: "analytics", root: "modules/analytics", classification: "core", subjects: ["analytics"] },
];

const NOTHING: DeclaredOwnership = { records: [], exceptions: [], shared: [] };
const SHARED: DeclaredOwnership = {
  ...NOTHING,
  shared: [{ table: "trace_summaries", owner: "trace", readers: ["analytics"], reason: "fixture" }],
};

const TRACE_CLICKHOUSE = "modules/trace/process/src/repositories/clickhouse";
const ANALYTICS_CLICKHOUSE = "modules/analytics/process/src/repositories/clickhouse";
const DESCRIPTOR = `import { defineClickHouseTable } from "@langwatch/clickhouse-client/builder";
export const summaries = defineClickHouseTable({ name: "trace_summaries", tenantColumn: "TenantId" });
`;
const DESCRIPTOR_INSERT = `import { summaries } from "./clickhouse.trace-summaries.table.ts";
export async function store(client: { insert: (options: unknown) => Promise<void> }) {
  await client.insert({ table: summaries.$table.name, values: [], format: "JSONEachRow" });
}
`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "clickhouse-descriptors-"));
  roots.push(root);
  const write = (file: string, content: string) => {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  write(
    "packages/clickhouse-migrations/migrations/00001_create_trace_summaries.sql",
    `-- +goose Up
CREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.trace_summaries (TenantId String) ENGINE = MergeTree;
`,
  );

  return {
    write,
    traceOwns: () => {
      write(`${TRACE_CLICKHOUSE}/clickhouse.trace-summaries.table.ts`, DESCRIPTOR);
      write(`${TRACE_CLICKHOUSE}/clickhouse.trace-summary.repository.ts`, DESCRIPTOR_INSERT);
    },
    messages: (declared: DeclaredOwnership = NOTHING) =>
      collectClickhouseOwnershipFindings(root, CATALOGUE, declared).map(
        (finding) => finding.message,
      ),
    access: (module: string) =>
      clickhouseScanAt(root, CATALOGUE)
        .access.filter((entry) => entry.module === module)
        .map(({ table, line, write }) => ({ table, line, write })),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ClickHouse table descriptors", () => {
  describe("given the owner writes through a descriptor", () => {
    /** @scenario "A module inserting through its descriptor's table name owns the table" */
    it("makes the inserting module the owner", () => {
      const workspace = fixture();
      workspace.traceOwns();

      expect(workspace.messages()).toEqual([]);
    });

    /** @scenario "A constant set from a descriptor's table name is that table" */
    it("resolves a constant bound to the descriptor's table name", () => {
      const workspace = fixture();
      workspace.write(`${TRACE_CLICKHOUSE}/clickhouse.trace-summaries.table.ts`, DESCRIPTOR);
      workspace.write(
        `${TRACE_CLICKHOUSE}/clickhouse.trace-summary.repository.ts`,
        `import { summaries } from "./clickhouse.trace-summaries.table.ts";
const TABLE_NAME = summaries.$table.name;
export async function store(client: { insert: (options: unknown) => Promise<void> }) {
  await client.insert({ table: TABLE_NAME, values: [], format: "JSONEachRow" });
}
export const sql = \`INSERT INTO \${TABLE_NAME} (TenantId) VALUES (1)\`;
`,
      );

      expect(workspace.access("trace")).toEqual([
        { table: "trace_summaries", line: 4, write: true },
        { table: "trace_summaries", line: 6, write: true },
      ]);
      expect(workspace.messages()).toEqual([]);
    });

    /** @scenario "A database-qualified insert through a descriptor's table name is a write" */
    it("resolves the descriptor after the database dot, and nothing for an unbound name", () => {
      const workspace = fixture();
      workspace.write(`${TRACE_CLICKHOUSE}/clickhouse.trace-summaries.table.ts`, DESCRIPTOR);
      workspace.write(
        `${TRACE_CLICKHOUSE}/clickhouse.trace-summary.repository.ts`,
        `import { summaries } from "./clickhouse.trace-summaries.table.ts";
export async function store(client: Client, database: string) {
  await client.insert({ table: \`\${database}.\${summaries.$table.name}\`, values: [] });
  await client.insert({ table: \`\${database}.\${unbound.$table.name}\`, values: [] });
}
`,
      );

      expect(workspace.access("trace")).toEqual([
        { table: "trace_summaries", line: 3, write: true },
      ]);
    });

    /** @scenario "A descriptor reached through a re-export is still the table" */
    it("follows a descriptor through a barrel that re-exports it", () => {
      const workspace = fixture();
      workspace.write("modules/trace/process/src/tables/summaries.ts", DESCRIPTOR);
      workspace.write(
        "modules/trace/process/src/tables/index.ts",
        `export { summaries as traceSummaries } from "./summaries.ts";\n`,
      );
      workspace.write(
        `${TRACE_CLICKHOUSE}/clickhouse.trace-summary.repository.ts`,
        `import { traceSummaries } from "../../tables/index.ts";
export async function store(client: Client) {
  await client.insert({ table: traceSummaries.$table.name, values: [] });
}
`,
      );

      expect(workspace.access("trace")).toEqual([
        { table: "trace_summaries", line: 3, write: true },
      ]);
      expect(workspace.messages()).toEqual([]);
    });
  });

  describe("given another module reads through a descriptor", () => {
    /** @scenario "A builder read from a foreign descriptor is a foreign read" */
    it("reports a builder read from analytics' own descriptor of trace's table", () => {
      const workspace = fixture();
      workspace.traceOwns();
      workspace.write(`${ANALYTICS_CLICKHOUSE}/clickhouse.trace-summaries.table.ts`, DESCRIPTOR);
      workspace.write(
        `${ANALYTICS_CLICKHOUSE}/summary-read.repository.ts`,
        `import { clickhouseRead } from "@langwatch/clickhouse-client/builder";
import { summaries } from "./clickhouse.trace-summaries.table.ts";
export const read = () => clickhouseRead({ scope }).from(summaries).build();
`,
      );

      expect(workspace.messages()).toEqual(["analytics reads trace_summaries, owned by trace."]);
    });

    /** @scenario "A builder read from a foreign descriptor is a foreign read" */
    it("reads a builder call with a space before its bracket", () => {
      const workspace = fixture();
      workspace.traceOwns();
      workspace.write(`${ANALYTICS_CLICKHOUSE}/clickhouse.trace-summaries.table.ts`, DESCRIPTOR);
      workspace.write(
        `${ANALYTICS_CLICKHOUSE}/summary-read.repository.ts`,
        `import { summaries } from "./clickhouse.trace-summaries.table.ts";
export const read = () => clickhouseRead({ scope }).from (summaries).build();
`,
      );

      expect(workspace.messages()).toEqual(["analytics reads trace_summaries, owned by trace."]);
    });

    /** @scenario "A builder join on a foreign descriptor is a foreign read" */
    it("reports a join on an imported descriptor", () => {
      const workspace = fixture();
      workspace.traceOwns();
      workspace.write(
        `${ANALYTICS_CLICKHOUSE}/summary-join.repository.ts`,
        `import { summaries } from "../../../../../trace/process/src/repositories/clickhouse/clickhouse.trace-summaries.table.ts";
export const read = (query: Query) => query.leftJoin(summaries, on).build();
`,
      );

      expect(workspace.messages()).toEqual(["analytics reads trace_summaries, owned by trace."]);
    });

    /** @scenario "A read handed a descriptor's table name is a read" */
    it("reports a read helper handed the descriptor's table name", () => {
      const workspace = fixture();
      workspace.traceOwns();
      workspace.write(`${ANALYTICS_CLICKHOUSE}/clickhouse.trace-summaries.table.ts`, DESCRIPTOR);
      workspace.write(
        `${ANALYTICS_CLICKHOUSE}/summary-read.repository.ts`,
        `import { summaries } from "./clickhouse.trace-summaries.table.ts";
export const rows = (client: Client) => client.read({ statement, table: summaries.$table.name });
`,
      );

      expect(workspace.messages()).toEqual(["analytics reads trace_summaries, owned by trace."]);
    });

    /** @scenario "A foreign descriptor read on the share list passes" */
    it("admits a shared table's named reader", () => {
      const workspace = fixture();
      workspace.traceOwns();
      workspace.write(`${ANALYTICS_CLICKHOUSE}/clickhouse.trace-summaries.table.ts`, DESCRIPTOR);
      workspace.write(
        `${ANALYTICS_CLICKHOUSE}/summary-read.repository.ts`,
        `import { summaries } from "./clickhouse.trace-summaries.table.ts";
export const read = () => clickhouseRead({ scope }).from(summaries).build();
`,
      );

      expect(workspace.messages(SHARED)).toEqual([]);
    });

    /** @scenario "Declaring a descriptor is not access" */
    it("counts no read for a descriptor nothing uses", () => {
      const workspace = fixture();
      workspace.traceOwns();
      workspace.write(`${ANALYTICS_CLICKHOUSE}/clickhouse.trace-summaries.table.ts`, DESCRIPTOR);

      expect(workspace.messages()).toEqual([]);
      expect(workspace.messages(SHARED)).toEqual([
        "Table trace_summaries is shared with analytics, which no longer reads it. Delete the reader.",
      ]);
    });

    /** @scenario "A local alias of a foreign descriptor is a foreign read" */
    it("reports a builder read from a local alias of the descriptor", () => {
      const workspace = fixture();
      workspace.traceOwns();
      workspace.write(`${ANALYTICS_CLICKHOUSE}/clickhouse.trace-summaries.table.ts`, DESCRIPTOR);
      workspace.write(
        `${ANALYTICS_CLICKHOUSE}/summary-read.repository.ts`,
        `import { summaries } from "./clickhouse.trace-summaries.table.ts";
export function read() {
  const first = summaries;
  const table = first;
  return clickhouseRead({ scope }).from(table).build();
}
`,
      );

      expect(workspace.messages()).toEqual(["analytics reads trace_summaries, owned by trace."]);
      expect(workspace.messages(SHARED)).toEqual([]);
    });

    /** @scenario "A shadowed descriptor name resolves to its nearest binding" */
    it("resolves each read and write to the binding in scope where it is written", () => {
      const workspace = fixture();
      workspace.traceOwns();
      workspace.write(
        "packages/clickhouse-migrations/migrations/00002_create_analytics_own.sql",
        "-- +goose Up\nCREATE TABLE IF NOT EXISTS analytics_own (TenantId String) ENGINE = MergeTree;\n",
      );
      workspace.write(
        `${ANALYTICS_CLICKHOUSE}/clickhouse.own.table.ts`,
        `export const own = defineClickHouseTable({ name: "analytics_own", tenantColumn: "TenantId" });\n`,
      );
      workspace.write(`${ANALYTICS_CLICKHOUSE}/clickhouse.trace-summaries.table.ts`, DESCRIPTOR);
      workspace.write(
        `${ANALYTICS_CLICKHOUSE}/summary-read.repository.ts`,
        `import { own } from "./clickhouse.own.table.ts";
import { summaries } from "./clickhouse.trace-summaries.table.ts";
export async function both(client: Client) {
  {
    const own = summaries;
    clickhouseRead({ scope }).from(own).build();
    await client.insert({ table: own.$table.name, values: [] });
  }
  await client.insert({ table: own.$table.name, values: [] });
  return clickhouseRead({ scope }).from(own).build();
}
`,
      );

      expect(workspace.access("analytics")).toEqual([
        { table: "trace_summaries", line: 6, write: false },
        { table: "trace_summaries", line: 7, write: true },
        { table: "analytics_own", line: 9, write: true },
        { table: "analytics_own", line: 10, write: false },
      ]);
    });
  });
});
