// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `hasPollerCursor` decides whether the edit drawer still offers a backfill
 * start, so a wrong answer is silent in both directions: answer "yes" too
 * eagerly and an editable setting disappears from a source that never pulled;
 * answer "no" too eagerly and the form accepts a start date the usage cursor
 * will ignore, because that cursor deliberately never rewinds.
 *
 * The column is a Prisma `Json?` field. The current writer stores either
 * `Prisma.JsonNull` or a string, both of which `!= null` would handle; the
 * object cases below are the ones it would not, and `cursorOf` in
 * ingestionPullLifecycle.ts still handles object-shaped cursors, so they are
 * not hypothetical.
 *
 * Spec: specs/governance/edit-pull-source-config.feature
 */

import { describe, expect, it } from "vitest";

import { hasPollerCursor } from "../src/adapters/poller-cursor.adapter";

describe("hasPollerCursor", () => {
  describe("given a source that has never pulled", () => {
    it("treats SQL NULL as no cursor", () => {
      expect(hasPollerCursor(null)).toBe(false);
    });

    it("treats a missing column as no cursor", () => {
      expect(hasPollerCursor(undefined)).toBe(false);
    });

    it("treats JSON null that arrived as a string as no cursor", () => {
      expect(hasPollerCursor("null")).toBe(false);
    });

    it("treats an empty string as no cursor", () => {
      expect(hasPollerCursor("")).toBe(false);
    });

    it("treats an object with no content as no cursor", () => {
      expect(hasPollerCursor({})).toBe(false);
    });

    /**
     * `cursorOf` turns the empty object above into this string, so the two
     * have to answer alike — otherwise the same absent cursor locks the
     * backfill start on one path and leaves it editable on the other.
     */
    it("treats a serialised empty object as no cursor", () => {
      expect(hasPollerCursor("{}")).toBe(false);
    });
  });

  describe("given a source that has pulled", () => {
    it("reads a cursor stored as a JSON object", () => {
      expect(hasPollerCursor({ startingAt: "2026-08-20T00:00:00Z", page: null })).toBe(true);
    });

    /**
     * Both encodings have been observed for the same adapter, so the predicate
     * commits to neither.
     */
    it("reads a cursor stored as serialised JSON", () => {
      expect(hasPollerCursor('{"startingAt":"2026-08-20T00:00:00Z"}')).toBe(true);
    });

    it("reads a cursor whose only content is a falsy value", () => {
      expect(hasPollerCursor({ page: 0 })).toBe(true);
    });

    /**
     * An adapter's page token is opaque: not JSON, and not required to be.
     * Reading content out of the parse must not cost it its answer.
     */
    it("reads an opaque page token that is not JSON", () => {
      expect(hasPollerCursor("eyJwYWdlIjoyfQ")).toBe(true);
    });
  });
});
