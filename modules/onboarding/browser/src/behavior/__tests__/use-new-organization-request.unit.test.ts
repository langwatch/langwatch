import { describe, expect, it } from "vitest";

import { selectingNewOrganization } from "../use-new-organization-request.ts";

const graph = [
  { id: "organization_old", slug: "old-co" },
  { id: "organization_new", slug: "new-co" },
];

describe("selectingNewOrganization", () => {
  /** @scenario The coding-agent track of a new organization lands in that organization */
  it("selects the new organization by slug on the home landing", async () => {
    await expect(
      selectingNewOrganization({
        landing: "/",
        organizationId: "organization_new",
        fetchScopeGraph: () => Promise.resolve(graph),
      }),
    ).resolves.toBe("/?org=new-co");
  });

  it("keeps a landing that already names the project", async () => {
    await expect(
      selectingNewOrganization({
        landing: "/onboarding/product?projectSlug=demo",
        organizationId: "organization_new",
        fetchScopeGraph: () => Promise.reject(new Error("not asked")),
      }),
    ).resolves.toBe("/onboarding/product?projectSlug=demo");
  });

  it("falls back to the plain landing when the graph cannot be read", async () => {
    await expect(
      selectingNewOrganization({
        landing: "/",
        organizationId: "organization_new",
        fetchScopeGraph: () => Promise.reject(new Error("offline")),
      }),
    ).resolves.toBe("/");
  });
});
