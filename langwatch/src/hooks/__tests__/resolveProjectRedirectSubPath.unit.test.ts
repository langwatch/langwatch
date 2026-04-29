import { describe, expect, it } from "vitest";
import { resolveProjectRedirectSubPath } from "../useOrganizationTeamProject";

describe("resolveProjectRedirectSubPath()", () => {
  describe("when the pathname has a plain slug prefix", () => {
    it("extracts the sub-path after the project slug", () => {
      expect(
        resolveProjectRedirectSubPath("/old-slug/messages", "old-slug")
      ).toBe("/messages");
    });

    it("returns empty string when pathname matches the slug exactly", () => {
      expect(
        resolveProjectRedirectSubPath("/old-slug", "old-slug")
      ).toBe("");
    });
  });

  describe("when the pathname has an encoded project slug", () => {
    it("matches %5Bproject%5D against decoded [project]", () => {
      expect(
        resolveProjectRedirectSubPath(
          "/%5Bproject%5D/evaluations",
          "[project]"
        )
      ).toBe("/evaluations");
    });
  });

  describe("when the sub-path contains encoded characters", () => {
    it("preserves %23 (hash) in the sub-path", () => {
      expect(
        resolveProjectRedirectSubPath(
          "/old-slug/messages/a%23b",
          "old-slug"
        )
      ).toBe("/messages/a%23b");
    });

    it("preserves %3F (question mark) in the sub-path", () => {
      expect(
        resolveProjectRedirectSubPath(
          "/old-slug/messages/a%3Fb",
          "old-slug"
        )
      ).toBe("/messages/a%3Fb");
    });

    it("preserves %2F (slash) in the sub-path", () => {
      expect(
        resolveProjectRedirectSubPath(
          "/old-slug/messages/a%2Fb",
          "old-slug"
        )
      ).toBe("/messages/a%2Fb");
    });
  });

  describe("when pathname does not match any prefix", () => {
    it("returns empty string", () => {
      expect(
        resolveProjectRedirectSubPath("/unrelated/path", "old-slug")
      ).toBe("");
    });
  });
});
