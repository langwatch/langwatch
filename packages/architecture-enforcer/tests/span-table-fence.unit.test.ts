import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { clickhouseScanAt } from "../src/policies/persistence/clickhouse-table-ownership.ts";
import {
  collectSpanTableFenceFindings,
  type FenceBypass,
} from "../src/policies/persistence/span-table-fence.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";

/** @see specs/tooling/lint-span-table-fence.feature */

const CATALOGUE: FeatureCatalogueEntry[] = [
  { id: "trace", root: "modules/trace", classification: "core", subjects: ["trace"] },
];
const MIGRATION = `-- +goose Up
CREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.stored_spans (TenantId String) ENGINE = MergeTree;
CREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.trace_summaries (TenantId String) ENGINE = MergeTree;
`;
const WRITER = `export async function store(client: { insert: (options: unknown) => Promise<void> }) {
  await client.insert({ table: "stored_spans", values: [], format: "JSONEachRow" });
  await client.insert({ table: "trace_summaries", values: [], format: "JSONEachRow" });
}
`;
const READER = "modules/trace/process/src/repositories/clickhouse/span-read.repository.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function findingsOf({
  reader,
  bypasses = [],
}: {
  reader: string;
  bypasses?: readonly FenceBypass[];
}): string[] {
  const root = mkdtempSync(join(tmpdir(), "span-table-fence-"));
  roots.push(root);
  const write = (file: string, content: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  };
  write("packages/clickhouse-migrations/migrations/00001_create.sql", MIGRATION);
  write("modules/trace/process/src/repositories/clickhouse/span-store.repository.ts", WRITER);
  write(READER, reader);
  const scan = clickhouseScanAt(root, CATALOGUE);

  return collectSpanTableFenceFindings({ scan, root, bypasses }).map((finding) => finding.message);
}

const read = (sql: string) => `export const query = () => \`${sql}\`;\n`;

describe("span-table-fence", () => {
  describe("given a span-table read that spells its own tenant predicate", () => {
    /** @scenario "a span-table read spelling its own tenant predicate is reported" */
    it("reports the read", () => {
      expect(
        findingsOf({
          reader: read("SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String}"),
        }),
      ).toEqual([
        "trace reads stored_spans in a statement that spells its own tenant predicate, bypassing the fence.",
      ]);
    });
  });

  describe("given a span-table read with no marker", () => {
    /** @scenario "a span-table read with no fence marker is reported" */
    it("reports the read", () => {
      expect(findingsOf({ reader: read("SELECT TraceId FROM trace_summaries LIMIT 1") })).toEqual([
        "trace reads trace_summaries in a statement that carries no fence marker, bypassing the fence.",
      ]);
    });
  });

  describe("given a span-table read under a fence marker", () => {
    /** @scenario "a span-table read through a fence marker passes" */
    it("reports nothing, a join key on two tenant columns included", () => {
      const reader = [
        'import { tenantScopeWithConditions } from "@langwatch/clickhouse-markers";',
        "export const query = () => `SELECT s.SpanId FROM stored_spans s",
        "  JOIN trace_summaries t ON s.TenantId = t.TenantId",
        '  WHERE ${tenantScopeWithConditions("StartTime")}`;',
        "",
      ].join("\n");

      expect(findingsOf({ reader })).toEqual([]);
    });
  });

  describe("given a named bypass", () => {
    const bypass: FenceBypass = {
      module: "trace",
      table: "stored_spans",
      file: READER,
      reason: "a system read",
    };

    /** @scenario "a named bypass passes and a stale one is reported" */
    it("lets the named read through and reports a stale bypass", () => {
      const stale: FenceBypass = { ...bypass, table: "trace_summaries" };

      expect(
        findingsOf({
          reader: read("SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String}"),
          bypasses: [bypass, stale],
        }),
      ).toEqual([
        `The fence bypass for trace reading trace_summaries in ${READER} matches no read. Delete it.`,
      ]);
    });
  });
});
