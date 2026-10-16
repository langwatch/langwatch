/** @vitest-environment node */

/**
 * Scenario's declared id indexes against the goose file that creates them (goose 00115 and
 * 00120): each index the fill visits has a table keyed as declared, and a view that feeds it
 * from the source's own time column.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SCENARIO_ID_INDEXES,
  SCENARIO_SECOND_ID_INDEXES,
} from "../clickhouse.scenario-id-indexes.database.ts";

const MIGRATIONS = resolve(
  import.meta.dirname,
  "../../../../../../../packages/clickhouse-migrations/migrations",
);
const GOOSE_FILES = ["00115_scenario_id_indexes.sql", "00120_scenario_second_id_index.sql"];

/** The statement block that creates `name`, from its CREATE to its StatementEnd. */
function blockOf({ migration, create }: { migration: string; create: string }): string {
  const start = migration.indexOf(create);
  if (start < 0) return "";
  const end = migration.indexOf("-- +goose StatementEnd", start);
  return migration.slice(start, end < 0 ? undefined : end);
}

const ALL_INDEXES = [...SCENARIO_ID_INDEXES, ...SCENARIO_SECOND_ID_INDEXES];

describe("Scenario id index declarations", () => {
  const migration = GOOSE_FILES.map((file) => readFileSync(resolve(MIGRATIONS, file), "utf8")).join(
    "\n",
  );

  describe("given the goose file that creates the indexes", () => {
    it("declares one table per index, keyed by tenant then the declared id columns", () => {
      for (const declaration of ALL_INDEXES) {
        const table = blockOf({
          migration,
          create: `CREATE TABLE IF NOT EXISTS \${CLICKHOUSE_DATABASE}.${declaration.index}\n`,
        });

        expect(table, declaration.index).not.toBe("");
        expect(table, declaration.index).toContain(
          `ORDER BY (${["TenantId", ...declaration.key].join(", ")})`,
        );
        for (const column of declaration.key) {
          expect(table, declaration.index).toContain(`  ${column} String,`);
        }
      }
    });

    it("feeds each index from its source's own time column, grouped by the declared key", () => {
      for (const declaration of ALL_INDEXES) {
        const view = blockOf({
          migration,
          create: `CREATE MATERIALIZED VIEW IF NOT EXISTS \${CLICKHOUSE_DATABASE}.${declaration.index}_mv`,
        });
        const key = ["TenantId", ...declaration.key].join(", ");

        expect(view, declaration.index).toContain(
          `FROM \${CLICKHOUSE_DATABASE}.${declaration.source}`,
        );
        expect(view, declaration.index).toContain(`min(${declaration.time}) AS FromAt`);
        expect(view, declaration.index).toContain(`max(${declaration.time}) AS ToAt`);
        expect(view, declaration.index).toContain(`GROUP BY ${key}`);
        expect(view, declaration.index).toContain(
          "max(if(_retention_days = 0, 65535, _retention_days))",
        );
      }
    });

    it("declares no index the goose file does not create", () => {
      const created = [
        ...migration.matchAll(/CREATE TABLE IF NOT EXISTS \$\{CLICKHOUSE_DATABASE\}\.(\w+)/g),
      ]
        .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
        .toSorted((left, right) => left.localeCompare(right));

      expect(
        ALL_INDEXES.map((declaration) => declaration.index).toSorted((left, right) =>
          left.localeCompare(right),
        ),
      ).toEqual(created);
    });
  });

  describe("given each declared index", () => {
    it("copies its source's retention, so the fill raises it per target before the flag", () => {
      expect(ALL_INDEXES.every((index) => index.retention === "copied")).toBe(true);
    });
  });
});
