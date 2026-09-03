/**
 * Which organization and project the personal-workspace address is about.
 *
 * The organization graph is already in hand, so what is worth pinning is the
 * two decisions this makes rather than a fetch: which organization the page is
 * about, and which project the address is standing in, both resolved out of
 * the graph.
 */

import { describe, expect, it } from "vitest";
import {
  resolvePersonalWorkspaceOrganization,
  resolvePersonalWorkspaceProject,
} from "../src/features/personal-workspace/behavior/personal-workspace-scope-lookup";

const CHECKOUT = {
  id: "project_1",
  name: "Checkout",
  slug: "checkout",
  teamId: "team_1",
};

const ACME = {
  id: "org_acme",
  name: "ACME",
  slug: "acme",
  teams: [{ id: "team_1", name: "Platform", projects: [CHECKOUT] }],
};

const OTHER = { id: "org_other", name: "Other", slug: "other", teams: [] };

describe("given the organization graph is already in hand", () => {
  describe("when a screen asks which organization it is about", () => {
    it("resolves it from the scope rather than from the first row", () => {
      expect(
        resolvePersonalWorkspaceOrganization({
          organizationId: "org_other",
          organizations: [ACME, OTHER],
        }),
      ).toBe(OTHER);
    });

    it("has none when the scope names none", () => {
      expect(
        resolvePersonalWorkspaceOrganization({ organizationId: null, organizations: [ACME, OTHER] }),
      ).toBeUndefined();
    });
  });

  describe("when a project-scoped screen asks which project it is about", () => {
    it("finds it anywhere in the graph, under whichever team holds it", () => {
      expect(
        resolvePersonalWorkspaceProject({ projectId: "project_1", organizations: [ACME, OTHER] }),
      ).toBe(CHECKOUT);
    });

    it("has none when the scope names none, which is not the same as none existing", () => {
      expect(
        resolvePersonalWorkspaceProject({ projectId: null, organizations: [ACME, OTHER] }),
      ).toBeUndefined();
    });
  });
});
