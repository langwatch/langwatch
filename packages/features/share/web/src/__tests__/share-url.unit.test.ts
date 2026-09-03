/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { shareUrlForToken } from "../share-url";

describe("share url", () => {
  describe("when building the address a holder opens", () => {
    /**
     * The path segment is the TOKEN. A URL built from the row id resolves to
     * nothing, because id and token are independent values on the row.
     */
    it("puts the token in the path", () => {
      expect(shareUrlForToken("tok_abc")).toBe(`${window.location.origin}/share/tok_abc`);
    });
  });
});
