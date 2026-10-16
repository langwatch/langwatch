/**
 * Evaluation's id-index declaration against the goose file that creates it: the step fills what
 * the view fills, from the same columns. Spec: specs/clickhouse/id-index-reads.feature
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EVALUATION_ID_INDEXES,
  EVALUATION_SECOND_ID_INDEXES,
} from "../clickhouse.evaluation-id-indexes.database.ts";

const MIGRATIONS = resolve(
  import.meta.dirname,
  "../../../../../../../packages/clickhouse-migrations/migrations",
);

function gooseFile({ prefix }: { prefix: string }): string {
  const file = readdirSync(MIGRATIONS).find((name) => name.startsWith(prefix));
  if (file === undefined) throw new Error(`No goose file starts with ${prefix}.`);
  return readFileSync(resolve(MIGRATIONS, file), "utf8");
}

const migration = ["00112_", "00121_"].map((prefix) => gooseFile({ prefix })).join("\n");

const ALL_INDEXES = [...EVALUATION_ID_INDEXES, ...EVALUATION_SECOND_ID_INDEXES];

describe("Evaluation's id-index declaration", () => {
  describe("when it is read against goose 00112 and 00121", () => {
    it("names exactly the indexes the file creates", () => {
      const created = [
        ...migration.matchAll(
          /CREATE TABLE IF NOT EXISTS \$\{CLICKHOUSE_DATABASE\}\.(\w+_id_index)\s/g,
        ),
      ].map((match) => match[1]);

      expect(ALL_INDEXES.map((each) => each.index)).toEqual(created);
    });

    it("orders each index by tenant then its key, and fills it from its source's key", () => {
      for (const declaration of ALL_INDEXES) {
        const keys = declaration.key.join(", ");

        expect(migration, declaration.index).toContain(`ORDER BY (TenantId, ${keys})`);
        expect(migration, declaration.index).toContain(
          `FROM \${CLICKHOUSE_DATABASE}.${declaration.source}\n`,
        );
        expect(migration, declaration.index).toContain(`GROUP BY TenantId, ${keys}`);
        expect(migration, declaration.index).toContain(
          `min(${declaration.time}) AS FromAt, max(${declaration.time}) AS ToAt`,
        );
      }
      const filters = ALL_INDEXES.flatMap((declaration) =>
        declaration.filter === undefined
          ? []
          : [{ index: declaration.index, clause: `WHERE ${declaration.filter}` }],
      );
      for (const { index, clause } of filters) {
        expect(migration, index).toContain(clause);
      }
    });

    it("retains on UpdatedAt, the column evaluation_runs expires on, not on ScheduledAt", () => {
      for (const declaration of ALL_INDEXES) {
        expect(declaration.time).toBe("ScheduledAt");
        expect(declaration.retentionAnchor).toBe("UpdatedAt");
      }
      expect(migration).toContain("max(UpdatedAt) AS RetainAt");
      expect(migration).toContain("toDateTime(RetainAt) + toIntervalDay(_retention_days + 7)");
    });

    it("copies the source's retention with keep-forever written as 65535", () => {
      for (const declaration of ALL_INDEXES) {
        expect(declaration.retention).toBe("copied");
        expect(migration).toContain("max(if(_retention_days = 0, 65535, _retention_days))");
      }
    });
  });
});
