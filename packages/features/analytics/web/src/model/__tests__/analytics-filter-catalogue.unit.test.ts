/**
 * The filter catalogue is a COPY, and this is what keeps it honest.
 *
 * `availableFilters` beside this test is a family-local copy of
 * `platform/app/src/server/filters/registry.ts`, taken because thirty-odd
 * platform modules still read the original and deletes-only forbids repointing
 * them. A copy of a vocabulary is only safe while something proves it still
 * answers for the whole vocabulary — and the vocabulary itself is not copied:
 * `filterFieldsEnum` is `@langwatch/analytics-contract`'s, so a field added
 * there without an entry here fails on this line rather than disappearing out
 * of the filter rail with nothing to show for it.
 */

import { filterFieldsEnum } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { availableFilters } from "../analytics-filter-catalogue";

describe("the analytics filter catalogue", () => {
  describe("given the contract's list of filter fields", () => {
    describe("when the catalogue is asked for each of them", () => {
      it("names every field the contract enumerates, and no others", () => {
        expect(Object.keys(availableFilters).sort()).toEqual([...filterFieldsEnum.options].sort());
      });

      /** @scenario "Every filter field the platform offers is still offered" */
      it("gives every field a reader-facing name and a query-string key", () => {
        for (const [field, definition] of Object.entries(availableFilters)) {
          expect(definition.name, `${field} has no name`).toBeTruthy();
          expect(definition.urlKey, `${field} has no urlKey`).toBeTruthy();
        }
      });

      /**
       * Two fields sharing a URL key would make the address ambiguous: setting
       * one would silently read back as the other, and clearing one would clear
       * both. Nothing else in the reading path can catch that.
       */
      it("gives each field a query-string key of its own", () => {
        const keys = Object.values(availableFilters).map((entry) => entry.urlKey);

        expect(new Set(keys).size).toBe(keys.length);
      });

      /** A field that requires another must require one the catalogue knows. */
      it("only requires fields the catalogue itself offers", () => {
        for (const definition of Object.values(availableFilters)) {
          if (definition.requiresKey) {
            expect(availableFilters[definition.requiresKey.filter]).toBeDefined();
          }
          if (definition.requiresSubkey) {
            expect(availableFilters[definition.requiresSubkey.filter]).toBeDefined();
          }
        }
      });
    });
  });
});
