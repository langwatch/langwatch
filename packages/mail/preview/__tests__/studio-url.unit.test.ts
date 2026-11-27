import { describe, expect, it } from "vitest";

import {
  buildSearch,
  decodePropsFragment,
  DEFAULT_URL_STATE,
  encodePropsFragment,
  parseUrlState,
} from "../studio-url.ts";

describe("studio-url", () => {
  describe("given the address bar's query state", () => {
    it("round-trips through parse and build", () => {
      const state = {
        ...DEFAULT_URL_STATE,
        view: "inspect" as const,
        templateId: "reset-password",
        fixtureName: "default",
        width: "mobile" as const,
        theme: "dark" as const,
      };

      expect(parseUrlState(buildSearch(state))).toEqual(state);
    });

    /** @scenario "The studio opens on the weekly digests, and old links still land" */
    it("opens the weekly digests when no view is given", () => {
      expect(parseUrlState("").view).toBe("review");
      expect(parseUrlState("?view=review").view).toBe("review");
    });

    /** @scenario "The studio opens on the weekly digests, and old links still land" */
    it("opens all other emails for the old Inspect and Gallery links", () => {
      expect(parseUrlState("?view=inspect").view).toBe("inspect");
      expect(parseUrlState("?view=gallery").view).toBe("inspect");
    });

    it("falls back to the default state when the query is empty", () => {
      expect(parseUrlState("")).toEqual(DEFAULT_URL_STATE);
    });
  });

  describe("given a link's prop edits", () => {
    /** @scenario "The studio's shareable link survives a copy-paste" */
    it("returns the same edited props after an encode/decode round trip", () => {
      const edited = { recipientName: "Morgan Ellis", ceiling: 12345, nested: { ok: true } };

      const fragment = encodePropsFragment(edited);

      expect(decodePropsFragment(fragment)).toEqual(edited);
    });

    /** @scenario "A malformed shareable link falls back to the fixture" */
    it("falls back to undefined for a fragment that is not valid encoded props", () => {
      expect(decodePropsFragment("#props=not-valid-base64url!!!")).toBeUndefined();
    });

    it("falls back to undefined when the fragment carries no props at all", () => {
      expect(decodePropsFragment("")).toBeUndefined();
    });
  });
});
