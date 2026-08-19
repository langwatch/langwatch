/**
 * The language the editor offers beyond the schema: keywords and functions.
 *
 * The list is assistance for a read-only surface, so what matters is that the
 * words a member reaches for first are there, that nothing suggested could
 * write, and that the list stays clean enough to trust.
 *
 * Spec: specs/analytics/lwql-workbench.feature
 */

import { describe, expect, it } from "vitest";

import { LWQL_LANGUAGE_ITEMS } from "../logic/lwqlLanguageItems";

const labels = LWQL_LANGUAGE_ITEMS.map((item) => item.label);

/**
 * Anchored at the start and closed with a word boundary rather than `$`: a
 * label is refused for the statement it opens, so `INSERT INTO` has to be
 * caught by the same rule that catches `INSERT`. `GROUP BY` and `ORDER BY`
 * stay safe because no forbidden word is their first one.
 */
const WRITING_STATEMENT =
  /^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|SET|ATTACH|DETACH|RENAME|OPTIMIZE|SYSTEM)\b/i;

describe("the editor's language suggestions", () => {
  describe("given the static keyword and function lists", () => {
    describe("when a member starts typing a statement", () => {
      /** @scenario "Typing a keyword offers the keyword" */
      it("offers the words every LangWatchQL statement is built from", () => {
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
        for (const label of labels) {
          expect(label).not.toMatch(WRITING_STATEMENT);
        }
      });

      it("refuses a writing statement by its opening word, not only alone", () => {
        for (const statement of [
          "INSERT INTO",
          "CREATE TABLE",
          "ALTER TABLE",
          "DROP DATABASE",
          "SET ROLE",
        ]) {
          expect(statement).toMatch(WRITING_STATEMENT);
        }
      });

      it("leaves the reading clauses a member needs alone", () => {
        for (const clause of [
          "GROUP BY",
          "ORDER BY",
          "SELECT",
          "SETTINGS",
          "CREATED_AT",
        ]) {
          expect(clause).not.toMatch(WRITING_STATEMENT);
        }
      });

      it("names each suggestion exactly once", () => {
        expect(new Set(labels).size).toBe(labels.length);
      });

      it("marks every entry as a keyword or a function, nothing else", () => {
        for (const item of LWQL_LANGUAGE_ITEMS) {
          expect(["keyword", "function"]).toContain(item.kind);
        }
      });
    });
  });
});
