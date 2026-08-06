/**
 * The language the editor offers beyond the schema: keywords and functions.
 *
 * The list is assistance for a read-only surface, so what matters is that the
 * words a member reaches for first are there, that nothing suggested could
 * write, and that the list stays clean enough to trust.
 *
 * Spec: specs/analytics/governed-sql-workbench.feature
 */

import { describe, expect, it } from "vitest";

import { GOVERNED_SQL_LANGUAGE_ITEMS } from "../logic/governedSqlLanguageItems";

const labels = GOVERNED_SQL_LANGUAGE_ITEMS.map((item) => item.label);

describe("the editor's language suggestions", () => {
  describe("given the static keyword and function lists", () => {
    describe("when a member starts typing a statement", () => {
      /** @scenario "Typing a keyword offers the keyword" */
      it("offers the words every governed statement is built from", () => {
        for (const keyword of [
          "SELECT",
          "FROM",
          "WHERE",
          "GROUP BY",
          "LIMIT",
        ]) {
          expect(labels).toContain(keyword);
        }
        for (const fn of ["count", "subtractDays", "toStartOfDay", "uniq"]) {
          expect(labels).toContain(fn);
        }
      });
    });

    describe("when the list is checked against the surface's policy", () => {
      it("suggests nothing that could write, define, or grant", () => {
        const forbidden =
          /^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|SET|ATTACH|DETACH|RENAME|OPTIMIZE|SYSTEM)$/i;
        for (const label of labels) {
          expect(label).not.toMatch(forbidden);
        }
      });

      it("names each suggestion exactly once", () => {
        expect(new Set(labels).size).toBe(labels.length);
      });

      it("marks every entry as a keyword or a function, nothing else", () => {
        for (const item of GOVERNED_SQL_LANGUAGE_ITEMS) {
          expect(["keyword", "function"]).toContain(item.kind);
        }
      });
    });
  });
});
