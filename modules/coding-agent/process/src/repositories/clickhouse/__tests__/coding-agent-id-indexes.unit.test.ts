import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { CODING_AGENT_ID_INDEXES } from "../clickhouse.coding-agent-id-indexes.database.ts";

const MIGRATIONS_DIR = join(
  dirname(createRequire(import.meta.url).resolve("@langwatch/clickhouse-migrations")),
  "..",
  "migrations",
);

const goose = readFileSync(join(MIGRATIONS_DIR, "00117_coding_agent_id_indexes.sql"), "utf8");

/** The statement block that creates `name`, up to the next goose marker. */
function blockCreating(name: string): string {
  const start = goose.indexOf(`.${name}\n`);
  if (start < 0) throw new Error(`00117 creates no ${name}`);
  return goose.slice(start, goose.indexOf("-- +goose StatementEnd", start));
}

describe("the coding-agent id index declarations", () => {
  it("names the three sources the plan lists, in the order the fill visits them", () => {
    expect(CODING_AGENT_ID_INDEXES.map((each) => each.source)).toEqual([
      "coding_agent_sessions",
      "coding_agent_session_events",
      "coding_agent_trace_sessions",
    ]);
  });

  describe.each(CODING_AGENT_ID_INDEXES.map((each) => [each.index, each] as const))(
    "given the declaration of %s",
    (_name, declaration) => {
      it("is the source's name with the id-index suffix", () => {
        expect(declaration.index).toBe(`${declaration.source}_id_index`);
      });

      it("has a goose table ordered by the tenant then the declared key", () => {
        const table = blockCreating(declaration.index);
        expect(table).toContain(`ORDER BY (TenantId, ${declaration.key.join(", ")})`);
        for (const column of declaration.key) {
          expect(table).toContain(`${column} String`);
        }
      });

      it("has a view that takes the declared time and groups by the declared key", () => {
        const view = blockCreating(`${declaration.index}_mv`);
        expect(view).toContain(`FROM \${CLICKHOUSE_DATABASE}.${declaration.source}\n`);
        expect(view).toContain(`min(${declaration.time}) AS FromAt`);
        expect(view).toContain(`max(${declaration.time}) AS ToAt`);
        expect(view).toContain(`GROUP BY TenantId, ${declaration.key.join(", ")}`);
      });

      it("copies the source's retention when it declares a copied one", () => {
        const view = blockCreating(`${declaration.index}_mv`);
        expect(declaration.retention).toBe("copied");
        expect(view).toContain("max(if(_retention_days = 0, 65535, _retention_days))");
      });

      it("expires on its own time column, so no separate retention anchor is declared", () => {
        expect(declaration.retentionAnchor).toBe(declaration.time);
      });
    },
  );
});
