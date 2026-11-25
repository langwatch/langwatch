/**
 * @see specs/upgrade/upgrade-command.feature
 */
import { describe, expect, it } from "vitest";

import { differingPrebuiltIndexes, type IndexCatalogue } from "../prebuilt-indexes.ts";

type HeldIndex = { name: string; definition: string; valid: boolean };

/** Answers the catalogue read with the indexes the database holds, of the names asked. */
const holding = (indexes: readonly HeldIndex[]): IndexCatalogue => ({
  async query(_text, values) {
    const names: unknown = values[0];
    return {
      rows: indexes.filter((index) => Array.isArray(names) && names.includes(index.name)),
    };
  },
});

const CREATE = `CREATE UNIQUE INDEX IF NOT EXISTS "Widget_key_key" ON "Widget" ("key");`;
const SAME = `CREATE UNIQUE INDEX "Widget_key_key" ON mydb."Widget" USING btree (key)`;
const OTHER = `CREATE INDEX "Widget_key_key" ON mydb."Widget" USING btree ("createdAt")`;

describe("differingPrebuiltIndexes", () => {
  describe("when the index of that name was left invalid by a build that never finished", () => {
    /** @scenario "An invalid pre-built index under a migration's index name is refused" */
    it("names it as differing, though its definition matches", async () => {
      const differing = await differingPrebuiltIndexes({
        postgres: holding([{ name: "Widget_key_key", definition: SAME, valid: false }]),
        folders: [{ name: "20261002000000_add", sql: CREATE }],
      });
      expect(differing).toEqual([
        expect.objectContaining({ name: "Widget_key_key", is: expect.stringContaining("invalid") }),
      ]);
    });

    it("passes a valid index of the same definition", async () => {
      const differing = await differingPrebuiltIndexes({
        postgres: holding([{ name: "Widget_key_key", definition: SAME, valid: true }]),
        folders: [{ name: "20261002000000_add", sql: CREATE }],
      });
      expect(differing).toEqual([]);
    });
  });

  describe("when an earlier pending folder drops the index before a later one creates it", () => {
    /** @scenario "An index a pending migration drops before it creates it again is not compared" */
    it("names nothing", async () => {
      const differing = await differingPrebuiltIndexes({
        postgres: holding([{ name: "Widget_key_key", definition: OTHER, valid: true }]),
        folders: [
          { name: "20261002000000_drop", sql: `DROP INDEX IF EXISTS "Widget_key_key";` },
          { name: "20261003000000_add", sql: CREATE },
        ],
      });
      expect(differing).toEqual([]);
    });
  });
});
