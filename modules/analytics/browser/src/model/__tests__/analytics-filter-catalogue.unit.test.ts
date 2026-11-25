/**
 * `availableFilters` here is a family-local copy of the platform's filter
 * registry (thirty-odd modules still read the original). The vocabulary
 * itself isn't copied: a field added to `filterFieldsEnum` fails here.
 */

import { filterFieldsEnum } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { availableFilters } from "../analytics-filter-catalogue.ts";

describe("the analytics filter catalogue", () => {
  describe("given the contract's list of filter fields", () => {
    describe("when the catalogue is asked for each of them", () => {
      it("names every field the contract enumerates, and no others", () => {
        expect(Object.keys(availableFilters).toSorted()).toEqual(
          [...filterFieldsEnum.options].toSorted(),
        );
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
        const required = Object.values(availableFilters).flatMap((definition) => [
          ...(definition.requiresKey ? [definition.requiresKey.filter] : []),
          ...(definition.requiresSubkey ? [definition.requiresSubkey.filter] : []),
        ]);
        expect(Object.keys(availableFilters)).toEqual(expect.arrayContaining(required));
      });
    });
  });
});
