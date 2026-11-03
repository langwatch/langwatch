import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { GATEWAY_ID_INDEXES } from "../clickhouse.gateway-id-indexes.database.ts";

const MIGRATIONS_DIR = join(
  dirname(createRequire(import.meta.url).resolve("@langwatch/clickhouse-migrations")),
  "..",
  "migrations",
);

const goose = readFileSync(join(MIGRATIONS_DIR, "00118_gateway_id_indexes.sql"), "utf8");

/** The statement block that creates `name`, up to the next goose marker. */
function blockCreating(name: string): string {
  const start = goose.indexOf(`.${name}\n`);
  if (start < 0) throw new Error(`00118 creates no ${name}`);
  return goose.slice(start, goose.indexOf("-- +goose StatementEnd", start));
}

describe("the gateway id index declarations", () => {
  it("names gateway_spend then the budget ledger, in the order the fill visits them", () => {
    expect(GATEWAY_ID_INDEXES.map((each) => each.source)).toEqual([
      "gateway_spend",
      "gateway_budget_ledger_events",
    ]);
  });

  describe.each(GATEWAY_ID_INDEXES.map((each) => [each.index, each] as const))(
    "given the declaration of %s",
    (_name, declaration) => {
      it("is the source's name with the id-index suffix", () => {
        expect(declaration.index).toBe(`${declaration.source}_id_index`);
      });

      it("has a goose table ordered by the tenant then the declared key", () => {
        const table = blockCreating(declaration.index);
        expect(table).toContain(`ORDER BY (TenantId, ${declaration.key.join(", ")})`);
      });

      it("has a view that takes the declared time and groups by the declared key", () => {
        const view = blockCreating(`${declaration.index}_mv`);
        expect(view).toContain(`FROM \${CLICKHOUSE_DATABASE}.${declaration.source}\n`);
        expect(view).toContain(`min(${declaration.time}) AS FromAt`);
        expect(view).toContain(`max(${declaration.time}) AS ToAt`);
        expect(view).toContain(`GROUP BY TenantId, ${declaration.key.join(", ")}`);
      });

      it("copies no retention, as its source has no _retention_days column", () => {
        const view = blockCreating(`${declaration.index}_mv`);
        expect(declaration.retention).toBe("none");
        expect(view).toContain("max(toUInt16(65535)) AS _retention_days");
        expect(view).not.toContain("if(_retention_days");
      });
    },
  );

  it("keeps gateway_spend's index for its fixed 13 months plus seven days of slack, the fill marker forever", () => {
    expect(blockCreating("gateway_spend_id_index")).toContain(
      "TTL IF(TenantId = '', toDateTime('2106-01-01'), toDateTime(ToAt) + INTERVAL 13 MONTH + INTERVAL 7 DAY) DELETE",
    );
  });

  it("gives the budget ledger's index no TTL, as the ledger has none", () => {
    expect(blockCreating("gateway_budget_ledger_events_id_index")).not.toContain("TTL");
  });
});
