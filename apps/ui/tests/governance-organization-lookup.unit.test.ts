/**
 * Which of the reader's organizations the governance section is scoped to.
 *
 * What is worth pinning is the one decision this makes: which of the
 * organizations the reader can reach is the one this page is about.
 */

import { describe, expect, it } from "vitest";
import { resolveGovernanceOrganization } from "../src/features/governance/behavior/governance-organization-lookup";

const ACME = {
  id: "org_acme",
  name: "ACME",
  slug: "acme",
  teams: [
    {
      id: "team_1",
      name: "Platform",
      projects: [{ id: "project_1", name: "Checkout", slug: "checkout" }],
    },
  ],
};

const OTHER = { id: "org_other", name: "Other", slug: "other", teams: [] };

describe("given the reader's organizations", () => {
  describe("when the page is scoped to an organization the reader can reach", () => {
    it("answers with that organization and its teams, not the first one", () => {
      expect(
        resolveGovernanceOrganization({
          organizationId: "org_other",
          organizations: [ACME, OTHER],
        }),
      ).toBe(OTHER);
      expect(
        resolveGovernanceOrganization({ organizationId: "org_acme", organizations: [ACME, OTHER] })
          ?.teams[0]?.projects[0]?.name,
      ).toBe("Checkout");
    });
  });

  describe("when the scope has not resolved an organization yet", () => {
    it("answers with nothing rather than guessing", () => {
      expect(
        resolveGovernanceOrganization({ organizationId: null, organizations: [ACME, OTHER] }),
      ).toBeUndefined();
    });
  });

  describe("when the scope names an organization the reader is not in", () => {
    it("answers with nothing rather than a mismatched row", () => {
      expect(
        resolveGovernanceOrganization({
          organizationId: "org_unknown",
          organizations: [ACME, OTHER],
        }),
      ).toBeUndefined();
    });
  });
});
