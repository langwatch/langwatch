/**
 * The process package proves every stock query against the real validator from a committed copy of
 * their SQL (it cannot depend on this package). This test keeps that copy equal to the catalogue.
 * Regenerate it with `UPDATE_STOCK_SQL_FIXTURE=1 pnpm test <this file>`.
 * @see modules/dashboard/specs/dashboards-v2.feature AC202
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { IMPLEMENTED_WIDGET_IDS, implementedWidget } from "../index.ts";

const FIXTURE = fileURLToPath(
  new URL(
    "../../../../../../process/src/langwatch-ql/__tests__/fixtures/stock-widget-queries.json",
    import.meta.url,
  ),
);

const catalogue = IMPLEMENTED_WIDGET_IDS.flatMap((id) =>
  (implementedWidget(id)?.definition.queries ?? []).map(({ name, sql }) => ({
    label: `${id}/${name}`,
    sql,
  })),
);

describe("given the stock queries the process package validates", () => {
  /** @scenario "AC202 Stock widgets: every stock query reads the sources parameter, except those on the exemption list" */
  it("keeps the committed copy equal to the catalogue", () => {
    if (process.env.UPDATE_STOCK_SQL_FIXTURE === "1") {
      writeFileSync(FIXTURE, `${JSON.stringify(catalogue, null, 1)}\n`);
    }

    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(catalogue);
  });
});
