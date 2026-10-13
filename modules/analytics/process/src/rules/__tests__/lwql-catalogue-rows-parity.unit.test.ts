/** The committed row types equal a render of the committed manifests they are generated from. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { renderClickHouseRows, renderPrismaRows } from "../lwql-catalogue.rules.ts";
import { LWQL_COLUMNS_MANIFEST } from "../lwql-columns-manifest.rules.ts";
import { LWQL_PRISMA_MANIFEST } from "../lwql-prisma-manifest.rules.ts";

function committed(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
}

describe("given the committed row types", () => {
  /** @scenario "The row types are regenerated with the manifests" */
  it("renders the ClickHouse rows from the columns manifest", () => {
    expect(
      committed("lwql-columns-manifest.generated.ts"),
      "regenerate with `pnpm generate:lwql-columns-manifest`",
    ).toBe(renderClickHouseRows({ manifest: LWQL_COLUMNS_MANIFEST }));
  });

  /** @scenario "The row types are regenerated with the manifests" */
  it("renders the Prisma rows from the Prisma manifest", () => {
    expect(
      committed("lwql-prisma-manifest.generated.ts"),
      "regenerate with `pnpm generate:lwql-prisma-manifest`",
    ).toBe(renderPrismaRows({ manifest: LWQL_PRISMA_MANIFEST }));
  });

  /** @scenario "The row types are regenerated with the manifests" */
  it("names no source as both a ClickHouse table and a Prisma model", () => {
    const tables = new Set(LWQL_COLUMNS_MANIFEST.tables.map((table) => table.name));
    expect(LWQL_PRISMA_MANIFEST.models.filter((model) => tables.has(model.name))).toEqual([]);
  });
});
