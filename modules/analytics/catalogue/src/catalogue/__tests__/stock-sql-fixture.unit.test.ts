/**
 * The process package proves every stock query against the real validator from a committed copy of
 * their SQL (it cannot depend on this package). This test keeps that copy equal to the catalogue.
 * Regenerate it with `pnpm test -u <this file>`.
 * @see modules/dashboard/specs/dashboards-v2.feature AC202
 */

import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { IMPLEMENTED_WIDGET_IDS, implementedWidget } from "../index.ts";

const FIXTURE = fileURLToPath(
  new URL(
    "../../../../process/src/langwatch-ql/__tests__/fixtures/stock-widget-queries.json",
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
  /** @scenario "AC202 Stock widgets: every stock query that names an origin-bearing view reads the sources parameter" */
  it("keeps the committed copy equal to the catalogue", async () => {
    await expect(`${JSON.stringify(catalogue, null, 1)}\n`).toMatchFileSnapshot(FIXTURE);
  });
});
