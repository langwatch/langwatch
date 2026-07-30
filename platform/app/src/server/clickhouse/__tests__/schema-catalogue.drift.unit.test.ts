/**
 * Pins {@link SCHEMA_CATALOGUE} to the migrations that actually create the
 * tables.
 *
 * This test is the entire reason the catalogue is trustworthy. Before it, three
 * hand-kept copies of the same facts had drifted — `TIME_PARTITIONED_TABLES`
 * covered 11 of the 33 tables, `TABLE_TIME_COLUMNS` covered 3, and the written
 * guidance named the wrong partition column for `evaluation_runs` — and not one
 * of them ever went red. The old cold-scan test iterated its own map and
 * asserted the entries already in it, which can only ever pass; nothing
 * compared any of them to the DDL.
 *
 * So the comparison is a function over (catalogue, parsed DDL) rather than a
 * pile of inline assertions: that way the failure paths can be exercised with a
 * deliberately wrong catalogue, and this file can demonstrate the guard failing
 * rather than merely asserting that it would.
 *
 * What it cannot check is `partitionColumnStability`, which describes the code
 * that writes each table rather than the DDL. All it can require is that every
 * entry declares one and explains it. That field is asserted by a person and is
 * the one place this file takes something on trust.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countMigrationFiles,
  type MigrationTableShape,
  readMigrationSchema,
} from "../migrationDdl";
import {
  CATALOGUE_TABLES,
  CONVENTION_EXEMPTIONS,
  SCHEMA_CATALOGUE,
  type TableShape,
} from "../schema-catalogue";

/**
 * Below this many migrations, assume the reader has stopped finding them rather
 * than that the migrations were deleted. Without a floor, a renamed directory
 * or a broken path resolution makes every comparison below vacuously true and
 * the guard reports a clean tree forever — which is exactly how the detector
 * this replaces rotted to 11 of 33 tables unnoticed.
 */
const MIGRATION_FILE_FLOOR = 40;

/**
 * Tables the migrations create that the catalogue is not required to describe.
 *
 * Empty on purpose. It exists so that the answer to a newly-created table is
 * "describe it", and skipping it is a visible edit to this list rather than a
 * silent omission.
 */
const NOT_CATALOGUED: readonly string[] = [];

/** One disagreement between the catalogue and the DDL. */
interface DriftFinding {
  readonly table: string;
  readonly problem: string;
}

/**
 * Every way the catalogue and the migrations disagree.
 *
 * Takes both sides as arguments so the failure paths are testable: the real
 * call passes the real catalogue, and the tests below pass mutated copies to
 * prove each check actually fires.
 */
function compareCatalogueToMigrations({
  catalogue,
  shapes,
}: {
  catalogue: Record<string, TableShape>;
  shapes: Map<string, MigrationTableShape>;
}): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const [table, shape] of shapes) {
    if (shape.partitionExpression === null) continue;
    if (NOT_CATALOGUED.includes(table)) continue;

    const entry = catalogue[table];
    if (!entry) {
      findings.push({
        table,
        problem:
          `${shape.definedIn} creates it, partitioned by ${shape.partitionExpression}, ` +
          `but SCHEMA_CATALOGUE has no entry for it — add one, including the ` +
          `partitionColumnStability nothing can derive for you`,
      });
      continue;
    }

    if (entry.partitionExpression !== shape.partitionExpression) {
      findings.push({
        table,
        problem:
          `catalogue says PARTITION BY ${entry.partitionExpression}, ` +
          `${shape.definedIn} says PARTITION BY ${shape.partitionExpression}`,
      });
    }

    if (!shape.partitionExpression.includes(entry.partitionColumn)) {
      findings.push({
        table,
        problem:
          `catalogue names ${entry.partitionColumn} as the column to filter on, ` +
          `but it does not appear in the partition expression ${shape.partitionExpression}`,
      });
    }

    if (entry.sortKey.join(", ") !== shape.sortKey.join(", ")) {
      findings.push({
        table,
        problem:
          `catalogue says ORDER BY (${entry.sortKey.join(", ")}), ` +
          `the migrations say ORDER BY (${shape.sortKey.join(", ")})`,
      });
    }

    if (entry.versionColumn !== shape.versionColumn) {
      findings.push({
        table,
        problem:
          `catalogue says the version column is ${entry.versionColumn ?? "none"}, ` +
          `${shape.definedIn} declares ${shape.versionColumn ?? "an engine with none"}`,
      });
    }

    for (const tenantColumn of entry.tenantColumns) {
      if (!shape.columns.includes(tenantColumn)) {
        findings.push({
          table,
          problem: `catalogue names ${tenantColumn} as a tenant column, but the table has no such column`,
        });
      }
    }

    for (const heavyColumn of entry.heavyColumns) {
      if (!shape.columns.includes(heavyColumn)) {
        findings.push({
          table,
          problem: `catalogue names ${heavyColumn} as a heavy column, but the table has no such column`,
        });
      }
    }
  }

  for (const table of Object.keys(catalogue)) {
    if (!shapes.has(table)) {
      findings.push({
        table,
        problem:
          "the catalogue describes it, but no migration leaves a table by that name — " +
          "it was dropped or renamed, so remove the entry",
      });
    }
  }

  return findings;
}

/** Renders findings into a failure a reader can act on without a debugger. */
function explain(findings: readonly DriftFinding[]): string {
  return findings
    .map(({ table, problem }) => `  ${table}: ${problem}`)
    .join("\n");
}

/** Writes a throwaway migration directory for exercising the DDL reader. */
function migrationDirectoryWith(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "ch-migrations-"));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(directory, name), body);
  }
  return directory;
}

describe("the schema catalogue", () => {
  describe("given the migrations as they stand", () => {
    /** @scenario "the comparison notices when it has stopped reading the migrations" */
    it("reads enough migrations to be meaningful", () => {
      expect(countMigrationFiles()).toBeGreaterThanOrEqual(
        MIGRATION_FILE_FLOOR,
      );
    });

    it("agrees with every partitioned table the migrations create", () => {
      const findings = compareCatalogueToMigrations({
        catalogue: SCHEMA_CATALOGUE,
        shapes: readMigrationSchema(),
      });

      expect(
        findings,
        `The catalogue and the ClickHouse migrations disagree:\n\n${explain(findings)}\n\n` +
          "SCHEMA_CATALOGUE describes the tables; the migrations create them. " +
          "Where they differ the migrations are right — fix the catalogue, " +
          "never a deployed migration.",
      ).toEqual([]);
    });

    it("describes every partitioned table, so nothing is invisible to the gate", () => {
      const partitioned = [...readMigrationSchema().values()]
        .filter((shape) => shape.partitionExpression !== null)
        .map((shape) => shape.table)
        .filter((table) => !NOT_CATALOGUED.includes(table));

      expect([...CATALOGUE_TABLES].sort()).toEqual([...partitioned].sort());
    });
  });

  describe("given a catalogue that disagrees with the migrations", () => {
    /** @scenario "a table created by a migration but missing from the catalogue is reported" */
    it("reports a table the catalogue never describes", () => {
      const { stored_spans: _omitted, ...withoutStoredSpans } =
        SCHEMA_CATALOGUE;

      const findings = compareCatalogueToMigrations({
        catalogue: withoutStoredSpans,
        shapes: readMigrationSchema(),
      });

      expect(findings).toContainEqual({
        table: "stored_spans",
        problem: expect.stringContaining("has no entry for it"),
      });
    });

    /** @scenario "a catalogue entry that names the wrong partition column is reported" */
    it("reports a partition column the migrations do not use", () => {
      const findings = compareCatalogueToMigrations({
        catalogue: {
          ...SCHEMA_CATALOGUE,
          evaluation_runs: {
            ...SCHEMA_CATALOGUE.evaluation_runs,
            partitionExpression: "toYearWeek(UpdatedAt)",
            partitionColumn: "UpdatedAt",
          },
        },
        shapes: readMigrationSchema(),
      });

      // The exact drift the written guidance carried: a range on UpdatedAt
      // prunes nothing, because the table partitions on ScheduledAt.
      expect(findings).toContainEqual({
        table: "evaluation_runs",
        problem: expect.stringContaining(
          "catalogue says PARTITION BY toYearWeek(UpdatedAt)",
        ),
      });
    });

    /** @scenario "a catalogue entry that names the wrong sort key is reported" */
    it("reports a sort key the migrations do not use", () => {
      const findings = compareCatalogueToMigrations({
        catalogue: {
          ...SCHEMA_CATALOGUE,
          simulation_runs: {
            ...SCHEMA_CATALOGUE.simulation_runs,
            sortKey: [
              "TenantId",
              "ScenarioSetId",
              "BatchRunId",
              "ScenarioRunId",
            ],
          },
        },
        shapes: readMigrationSchema(),
      });

      // Also the exact drift the written guidance carried.
      expect(findings).toContainEqual({
        table: "simulation_runs",
        problem: expect.stringContaining(
          "the migrations say ORDER BY (TenantId, ScenarioRunId)",
        ),
      });
    });

    it("reports an entry for a table no migration leaves behind", () => {
      const findings = compareCatalogueToMigrations({
        catalogue: {
          ...SCHEMA_CATALOGUE,
          gateway_activity_events: SCHEMA_CATALOGUE.billable_events,
        },
        shapes: readMigrationSchema(),
      });

      expect(findings).toContainEqual({
        table: "gateway_activity_events",
        problem: expect.stringContaining("no migration leaves a table"),
      });
    });

    it("reports a tenant column the table does not have", () => {
      const findings = compareCatalogueToMigrations({
        catalogue: {
          ...SCHEMA_CATALOGUE,
          stored_objects: {
            ...SCHEMA_CATALOGUE.stored_objects,
            tenantColumns: ["TenantId"],
          },
        },
        shapes: readMigrationSchema(),
      });

      // stored_objects is scoped by project_id; a gate that looked for
      // TenantId here would flag every correct read of it.
      expect(findings).toContainEqual({
        table: "stored_objects",
        problem: expect.stringContaining("no such column"),
      });
    });
  });

  describe("given the DDL reader and a migration set built to trip it", () => {
    /** @scenario "a sort key a later migration extended is read from the later migration" */
    it("reads an extended sort key from the migration that extended it", () => {
      const directory = migrationDirectoryWith({
        "00001_create.sql": [
          "-- +goose Up",
          "-- +goose StatementBegin",
          "CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.widgets",
          "(",
          "    TenantId String,",
          "    HourBucket DateTime,",
          "    WidgetId String",
          ")",
          "ENGINE = ReplacingMergeTree(UpdatedAt)",
          "PARTITION BY toYYYYMM(HourBucket)",
          "ORDER BY (TenantId, HourBucket, WidgetId);",
          "-- +goose StatementEnd",
        ].join("\n"),
        "00002_extend.sql": [
          "-- +goose Up",
          "-- +goose StatementBegin",
          "ALTER TABLE ${CLICKHOUSE_DATABASE}.widgets",
          "    MODIFY ORDER BY (TenantId, HourBucket, WidgetId, EventId);",
          "-- +goose StatementEnd",
        ].join("\n"),
      });

      expect(readMigrationSchema(directory).get("widgets")?.sortKey).toEqual([
        "TenantId",
        "HourBucket",
        "WidgetId",
        "EventId",
      ]);
    });

    /** @scenario "a table a later migration dropped is not required in the catalogue" */
    it("leaves out a table a later migration dropped", () => {
      const directory = migrationDirectoryWith({
        "00001_create.sql": [
          "-- +goose Up",
          "-- +goose StatementBegin",
          "CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.doomed",
          "( TenantId String, EventTimestamp DateTime )",
          "ENGINE = ReplacingMergeTree(UpdatedAt)",
          "PARTITION BY toYYYYMM(EventTimestamp)",
          "ORDER BY (TenantId);",
          "-- +goose StatementEnd",
        ].join("\n"),
        "00002_drop.sql": [
          "-- +goose Up",
          "DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.doomed;",
        ].join("\n"),
      });

      expect(readMigrationSchema(directory).has("doomed")).toBe(false);
    });

    it("ignores a DROP that only exists in a commented-out Down block", () => {
      const directory = migrationDirectoryWith({
        "00001_create.sql": [
          "-- +goose Up",
          "-- +goose StatementBegin",
          "CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.survivor",
          "( TenantId String, EventTimestamp DateTime )",
          "ENGINE = ReplacingMergeTree(UpdatedAt)",
          "PARTITION BY toYYYYMM(EventTimestamp)",
          "ORDER BY (TenantId);",
          "-- +goose StatementEnd",
          "",
          "-- +goose Down",
          "-- DROP TABLE IF EXISTS ${CLICKHOUSE_DATABASE}.survivor;",
        ].join("\n"),
      });

      // Nearly every migration ends this way. A reader that honoured commented
      // Down blocks would report an empty schema and every check above would
      // pass vacuously.
      expect(readMigrationSchema(directory).has("survivor")).toBe(true);
    });
  });

  describe("given the field no parser can derive", () => {
    /** @scenario "every catalogued table declares whether its partition column can move" */
    it("declares a partition-column stability for every table", () => {
      for (const table of CATALOGUE_TABLES) {
        expect(
          SCHEMA_CATALOGUE[table].partitionColumnStability,
          `${table} must declare whether its partition column can move`,
        ).toMatch(/^(?:frozen|movable|unverified)$/);
      }
    });

    /** @scenario "every stability declaration carries the evidence it was derived from" */
    it("explains every stability declaration", () => {
      for (const table of CATALOGUE_TABLES) {
        // Long enough to be a reason rather than a restatement of the value.
        expect(
          SCHEMA_CATALOGUE[table].stabilityRationale.length,
          `${table} declares a stability with no rationale to check it against`,
        ).toBeGreaterThan(40);
      }
    });

    it("keeps the two look-alike analytics tables classified apart", () => {
      // The pair that motivated the field: identical partition expressions,
      // created three migrations apart, opposite behaviour. If these two ever
      // agree, the field has been filled in by pattern-matching on the DDL.
      expect(SCHEMA_CATALOGUE.trace_analytics.partitionExpression).toBe(
        SCHEMA_CATALOGUE.evaluation_analytics.partitionExpression,
      );
      expect(SCHEMA_CATALOGUE.trace_analytics.partitionColumnStability).toBe(
        "frozen",
      );
      expect(
        SCHEMA_CATALOGUE.evaluation_analytics.partitionColumnStability,
      ).toBe("movable");
    });
  });

  describe("given the registered exceptions", () => {
    /** @scenario "every registered exception says why it exists" */
    it("names a rule and a reason on every exception", () => {
      for (const exemption of CONVENTION_EXEMPTIONS) {
        expect(exemption.rule).toMatch(
          /^(?:partition_predicate|tenant_predicate)$/,
        );
        expect(
          exemption.reason.length,
          `the ${exemption.table} exemption must say why it is sound`,
        ).toBeGreaterThan(40);
        expect(exemption.site).not.toBe("");
      }
    });

    it("registers every exception against a catalogued table", () => {
      for (const exemption of CONVENTION_EXEMPTIONS) {
        expect(CATALOGUE_TABLES).toContain(exemption.table);
      }
    });
  });
});
