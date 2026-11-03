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
const SECOND_DECLARED = `export const RUNS_BY_DATASET = defineIdIndex({ source: "dataset_runs", key: ["DatasetId"], time: "StartedAt", by: true });\n`;
const SECOND_TABLE =
  "CREATE TABLE IF NOT EXISTS dataset_runs_by_dataset_id_index (TenantId String) ENGINE = MergeTree;";
const SECOND_VIEW =
  "CREATE MATERIALIZED VIEW IF NOT EXISTS dataset_runs_by_dataset_id_index_mv TO dataset_runs_by_dataset_id_index AS SELECT 1;";
const SECOND_MIGRATION =
  "packages/clickhouse-migrations/migrations/00201_dataset_runs_by_dataset_id_index.sql";

function pairing(files: Readonly<Record<string, string>>): string[] {
  return lintIdIndexPairingAt({ root: workspace(files), catalogue: CATALOGUE }).map(
    (violation) => violation.message,
  );
}

function bounds(reads: string, { declared = DECLARED }: { declared?: string } = {}): number[] {
  const root = workspace({ [DECLARATIONS]: declared, [READS]: reads });
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

describe("id-index-pairing over a source's second index", () => {
  describe("given both declarations with their goose tables and views", () => {
    it("pairs each by its own name", () => {
      expect(
        pairing({
          [DECLARATIONS]: `${DECLARED}${SECOND_DECLARED}`,
          [MIGRATION]: goose([TABLE, VIEW]),
          [SECOND_MIGRATION]: goose([SECOND_TABLE, SECOND_VIEW]),
        }),
      ).toEqual([]);
    });
  });

  describe("given a second index on one side only", () => {
    it("reports its table with no declaration, and its declaration with no table or view", () => {
      expect(
        pairing({
          [DECLARATIONS]: DECLARED,
          [MIGRATION]: goose([TABLE, VIEW]),
          [SECOND_MIGRATION]: goose([SECOND_TABLE, SECOND_VIEW]),
        }),
      ).toEqual([
        "dataset_runs_by_dataset_id_index has no defineIdIndex declaration, so no read, fill or retention raise uses it.",
      ]);
      expect(
        pairing({
          [DECLARATIONS]: `${DECLARED}${SECOND_DECLARED}`,
          [MIGRATION]: goose([TABLE, VIEW]),
        }),
      ).toEqual([
        "dataset_runs_by_dataset_id_index is declared, but no goose migration creates it.",
        "dataset_runs_by_dataset_id_index is declared, but no goose migration creates its dataset_runs_by_dataset_id_index_mv view.",
      ]);
    });
  });
});

describe("id-index-bounds", () => {
  describe("given a source with a second index on another key", () => {
    const byDataset = [
      "export const byDataset = `SELECT * FROM dataset_runs",
      "  WHERE TenantId = {tenantId:String} AND DatasetId = {datasetId:String}`;",
      "",
    ].join("\n");

    it("reports a read by the second key once that index is declared", () => {
      expect(bounds(byDataset)).toEqual([]);
      expect(bounds(byDataset, { declared: `${DECLARED}${SECOND_DECLARED}` })).toEqual([1]);
    });

    it("accepts the second key's marker, and reports a read by both keys once", () => {
      const declared = `${DECLARED}${SECOND_DECLARED}`;
      expect(
        bounds(
          [
            "export const byDataset = `SELECT * FROM dataset_runs",
            "  WHERE TenantId = {tenantId:String} AND DatasetId = {datasetId:String}",
            "  {{idBound:dataset_runs.DatasetId:datasetId}}`;",
            "",
          ].join("\n"),
          { declared },
        ),
      ).toEqual([]);
      expect(
        bounds(
          "export const both = `SELECT * FROM dataset_runs WHERE DatasetId = {datasetId:String} AND RunId = {runId:String}`;\n",
          { declared },
        ),
      ).toEqual([1]);
    });
  });

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
