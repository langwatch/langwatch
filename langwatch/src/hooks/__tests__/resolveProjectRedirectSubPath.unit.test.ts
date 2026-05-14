import { describe, expect, it } from "vitest";
import { resolveProjectRedirectSubPath } from "../useOrganizationTeamProject";

describe("resolveProjectRedirectSubPath()", () => {
  describe("when the pathname has a plain slug prefix", () => {
    it("extracts the sub-path after the project slug", () => {
      expect(
        resolveProjectRedirectSubPath({
          pathname: "/old-slug/messages",
          oldProject: "old-slug",
        })
      ).toBe("/messages");
    });

    it("returns empty string when pathname matches the slug exactly", () => {
      expect(
        resolveProjectRedirectSubPath({
          pathname: "/old-slug",
          oldProject: "old-slug",
        })
      ).toBe("");
    });
  });

  describe("when the pathname has an encoded project slug", () => {
    it("matches %5Bproject%5D against decoded [project]", () => {
      expect(
        resolveProjectRedirectSubPath({
          pathname: "/%5Bproject%5D/evaluations",
          oldProject: "[project]",
        })
      ).toBe("/evaluations");
    });
  });

  describe("when the sub-path contains encoded characters", () => {
    it("preserves %23 (hash) in the sub-path", () => {
      expect(
        resolveProjectRedirectSubPath({
          pathname: "/old-slug/messages/a%23b",
          oldProject: "old-slug",
        })
      ).toBe("/messages/a%23b");
    });

    it("preserves %3F (question mark) in the sub-path", () => {
      expect(
        resolveProjectRedirectSubPath({
          pathname: "/old-slug/messages/a%3Fb",
          oldProject: "old-slug",
        })
      ).toBe("/messages/a%3Fb");
    });

    it("preserves %2F (slash) in the sub-path", () => {
      expect(
        resolveProjectRedirectSubPath({
          pathname: "/old-slug/messages/a%2Fb",
          oldProject: "old-slug",
        })
      ).toBe("/messages/a%2Fb");
    });
  });

  describe("when the slug is a prefix of a longer path segment", () => {
    it("does not match and returns empty string", () => {
      expect(
        resolveProjectRedirectSubPath({
          pathname: "/old-slugger/messages",
          oldProject: "old-slug",
        })
      ).toBe("");
    });
  });

  describe("when pathname does not match any prefix", () => {
    it("returns empty string", () => {
      expect(
        resolveProjectRedirectSubPath({
          pathname: "/unrelated/path",
          oldProject: "old-slug",
        })
      ).toBe("");
    });
  });
});
