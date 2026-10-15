/** Spec: specs/clickhouse/id-index-reads.feature. Plan: dev/docs/plans/id-index-2026-10-10.md. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { lintIdIndexBoundsAt } from "../src/policies/persistence/id-index-bounds.ts";
import { lintIdIndexPairingAt } from "../src/policies/persistence/id-index-pairing.ts";
import type { FeatureCatalogueEntry } from "../src/types.ts";

const CATALOGUE: FeatureCatalogueEntry[] = [
  { id: "dataset", root: "modules/dataset", classification: "core", subjects: ["dataset"] },
];
const DECLARATIONS = "modules/dataset/process/src/repositories/clickhouse/dataset-id-indexes.ts";
const READS = "modules/dataset/process/src/repositories/clickhouse/dataset-run.repository.ts";
const DECLARED = `export const RUNS = defineIdIndex({ source: "dataset_runs", key: ["RunId"], time: "StartedAt" });\n`;
const TABLE =
  "CREATE TABLE IF NOT EXISTS dataset_runs_id_index (TenantId String) ENGINE = MergeTree;";
const VIEW =
  "CREATE MATERIALIZED VIEW IF NOT EXISTS dataset_runs_id_index_mv TO dataset_runs_id_index AS SELECT 1;";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "id-index-policies-"));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

const goose = (statements: readonly string[]): string =>
  `-- +goose Up\n${statements.map((each) => `-- +goose StatementBegin\n${each}\n-- +goose StatementEnd\n`).join("")}`;

const MIGRATION = "packages/clickhouse-migrations/migrations/00200_dataset_runs_id_index.sql";

function pairing(files: Readonly<Record<string, string>>): string[] {
  return lintIdIndexPairingAt({ root: workspace(files), catalogue: CATALOGUE }).map(
    (violation) => violation.message,
  );
}

function bounds(reads: string): number[] {
  const root = workspace({ [DECLARATIONS]: DECLARED, [READS]: reads });
  return lintIdIndexBoundsAt({ root, catalogue: CATALOGUE }).map(
    (violation) => violation.line ?? 0,
  );
}

describe("id-index-pairing", () => {
  describe("given a declaration with its goose table and view", () => {
    it("reports nothing", () => {
      expect(pairing({ [DECLARATIONS]: DECLARED, [MIGRATION]: goose([TABLE, VIEW]) })).toEqual([]);
    });
  });

  describe("given an index and its declaration that do not pair", () => {
    /** @scenario "an id index and its declaration always come in pairs" */
    it("reports a table with no declaration, and a declaration with no table or view", () => {
      expect(pairing({ [MIGRATION]: goose([TABLE, VIEW]) })).toEqual([
        "dataset_runs_id_index has no defineIdIndex declaration, so no read, fill or retention raise uses it.",
      ]);
      expect(pairing({ [DECLARATIONS]: DECLARED })).toEqual([
        "dataset_runs_id_index is declared, but no goose migration creates it.",
        "dataset_runs_id_index is declared, but no goose migration creates its dataset_runs_id_index_mv view.",
      ]);
    });
  });
});

describe("id-index-bounds", () => {
  describe("given a module statement reading a declared source by its key", () => {
    /** @scenario "a read by id that skips its index is refused by the source check" */
    it("reports it when it carries neither the marker nor a reason to skip", () => {
      expect(
        bounds(
          [
            "export const byId = `SELECT * FROM dataset_runs",
            "  WHERE TenantId = {tenantId:String} AND RunId = {runId:String}`;",
            "",
          ].join("\n"),
        ),
      ).toEqual([1]);
    });

    it("accepts the marker and a reasoned skip", () => {
      expect(
        bounds(
          [
            "export const byId = `SELECT * FROM dataset_runs",
            "  WHERE TenantId = {tenantId:String} AND RunId = {runId:String}",
            "  {{idBound:dataset_runs.RunId:runId}}`;",
            "// ID_BOUND_SKIP: the caller's window already bounds this read",
            "export const windowed = `SELECT * FROM dataset_runs WHERE RunId IN ({runIds:Array(String)})`;",
            "",
          ].join("\n"),
        ),
      ).toEqual([]);
    });

    it("ignores a read by time range, which does not match the key", () => {
      expect(
        bounds(
          "export const page = `SELECT * FROM dataset_runs WHERE TenantId = {tenantId:String} AND StartedAt >= {from:DateTime64(3)}`;\n",
        ),
      ).toEqual([]);
    });
  });
});
