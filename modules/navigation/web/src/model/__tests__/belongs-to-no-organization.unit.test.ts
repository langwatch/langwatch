import { describe, expect, it } from "vitest";

import { belongsToNoOrganization } from "../belongs-to-no-organization.ts";

const resolved = {
  isWorkspaceResolving: false,
  organization: void 0,
  organizations: void 0 as readonly unknown[] | undefined,
};

describe("belongsToNoOrganization", () => {
  describe("when the graph answered with no organizations", () => {
    it("says the reader belongs to none", () => {
      expect(belongsToNoOrganization({ ...resolved, organizations: [] })).toBe(true);
    });
  });

  describe("when the graph has not answered", () => {
    it("does not mistake silence for an answer", () => {
      expect(belongsToNoOrganization({ ...resolved, organizations: void 0 })).toBe(false);
    });
  });

  describe("when the workspace is still resolving", () => {
    it("does not answer yet, whatever the graph currently holds", () => {
      expect(
        belongsToNoOrganization({
          ...resolved,
          isWorkspaceResolving: true,
          organizations: [],
        }),
      ).toBe(false);
    });
  });

  describe("when an organization resolved", () => {
    it("says the reader belongs somewhere", () => {
      expect(
        belongsToNoOrganization({
          ...resolved,
          organization: { id: "org-1" },
          organizations: [{ id: "org-1" }],
        }),
      ).toBe(false);
    });
  });
});
