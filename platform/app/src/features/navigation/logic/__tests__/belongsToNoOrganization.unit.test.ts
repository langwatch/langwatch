import { describe, expect, it } from "vitest";

import { belongsToNoOrganization } from "../belongsToNoOrganization";

const resolved = {
  isWorkspaceResolving: false,
  organization: undefined,
  organizations: undefined as readonly unknown[] | undefined,
};

describe("belongsToNoOrganization", () => {
  describe("when the graph answered with no organizations", () => {
    /** @scenario "Belonging to no organization is something the graph said" */
    it("says the reader belongs to none", () => {
      expect(belongsToNoOrganization({ ...resolved, organizations: [] })).toBe(
        true,
      );
    });
  });

  describe("when the graph has not answered", () => {
    /** @scenario "A graph that never answered is not an account without organizations" */
    it("does not mistake silence for an answer", () => {
      expect(
        belongsToNoOrganization({ ...resolved, organizations: undefined }),
      ).toBe(false);
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
