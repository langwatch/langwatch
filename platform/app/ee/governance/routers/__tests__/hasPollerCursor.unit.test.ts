// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `hasPollerCursor` decides whether the edit drawer still offers a backfill
 * start, so a wrong answer is silent in both directions: answer "yes" too
 * eagerly and an editable setting disappears from a source that never pulled;
 * answer "no" too eagerly and the form accepts a start date the usage cursor
 * will ignore, because that cursor deliberately never rewinds.
 *
 * The column is a Prisma Json field, which is why this is not a `!= null`
 * check — the shapes below are the ones that reach it in practice.
 *
 * Spec: specs/governance/edit-pull-source-config.feature
 */

import { describe, expect, it } from "vitest";

import { hasPollerCursor } from "../ingestionSources";

describe("hasPollerCursor", () => {
  describe("a source that has never pulled", () => {
    it("treats SQL NULL as no cursor", () => {
      expect(hasPollerCursor(null)).toBe(false);
    });

    it("treats a missing column as no cursor", () => {
      expect(hasPollerCursor(undefined)).toBe(false);
    });

    /**
     * The trap this predicate exists for. Prisma represents JSON null as a
     * sentinel object on some versions, and every truthiness or `!= null`
     * check reads that as a real cursor.
     */
    it("treats a Prisma JSON-null sentinel as no cursor", () => {
      class JsonNullSentinel {}
      expect(hasPollerCursor(new JsonNullSentinel())).toBe(false);
    });

    it("treats JSON null that arrived as a string as no cursor", () => {
      expect(hasPollerCursor("null")).toBe(false);
    });

    it("treats an empty string as no cursor", () => {
      expect(hasPollerCursor("")).toBe(false);
    });

    it("treats an empty object as no cursor", () => {
      expect(hasPollerCursor({})).toBe(false);
    });
  });

  describe("a source that has pulled", () => {
    it("reads a cursor stored as a JSON object", () => {
      expect(
        hasPollerCursor({ startingAt: "2026-08-20T00:00:00Z", page: null }),
      ).toBe(true);
    });

    /**
     * Both encodings have been observed for the same adapter, so the predicate
     * commits to neither.
     */
    it("reads a cursor stored as serialised JSON", () => {
      expect(hasPollerCursor('{"startingAt":"2026-08-20T00:00:00Z"}')).toBe(
        true,
      );
    });

    it("reads a cursor whose only content is a falsy value", () => {
      expect(hasPollerCursor({ page: 0 })).toBe(true);
    });
  });
});
