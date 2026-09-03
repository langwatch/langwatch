/**
 * The organization, project and team a gateway page is about, and the address
 * a registered drawer opens on — the three lookups and the one composition
 * `gateway-host.tsx` does not merely forward.
 */

import { describe, expect, it, vi } from "vitest";
import {
  resolveGatewayOrganization,
  resolveGatewayProject,
  resolveGatewayTeam,
} from "../src/features/gateway/behavior/gateway-scope-lookup";
import { openGatewayDrawer } from "../src/features/gateway/behavior/gateway-open-drawer";

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

const organizations = [ACME, OTHER];

describe("given a screen asking which organization it is about", () => {
  it("resolves it out of the graph the reader can already reach", () => {
    expect(resolveGatewayOrganization({ organizations, organizationId: "org_acme" })).toBe(ACME);
  });

  it("has no answer while the scope has not resolved", () => {
    expect(resolveGatewayOrganization({ organizations, organizationId: null })).toBeUndefined();
  });

  it("has no answer for an organization the reader cannot reach", () => {
    expect(
      resolveGatewayOrganization({ organizations, organizationId: "org_absent" }),
    ).toBeUndefined();
  });
});

describe("given a screen asking which project it is standing in", () => {
  it("finds it under whichever team holds it", () => {
    expect(resolveGatewayProject({ organizations, projectId: "project_1" })).toBe(CHECKOUT);
  });

  it("names the team that holds it", () => {
    expect(resolveGatewayTeam({ organizations, projectId: "project_1" })?.id).toBe("team_1");
  });

  it("has no answer for an address with no project in it", () => {
    expect(resolveGatewayProject({ organizations, projectId: null })).toBeUndefined();
    expect(resolveGatewayTeam({ organizations, projectId: null })).toBeUndefined();
  });
});

describe("given a screen opening a registered drawer", () => {
  it("writes the drawer's name and its own parameters, prefixed", () => {
    const setQuery = vi.fn();

    openGatewayDrawer({
      drawer: "routingPolicy",
      params: { policyId: "rp_1" },
      query: {},
      drawerOpenParam: "drawer.open",
      setQuery,
    });

    expect(setQuery).toHaveBeenCalledWith({
      "drawer.open": "routingPolicy",
      "drawer.policyId": "rp_1",
    });
  });

  it("keeps the reader's own query and drops the previous drawer's", () => {
    const setQuery = vi.fn();

    openGatewayDrawer({
      drawer: "routingPolicy",
      params: { seedScopeType: "ORGANIZATION" },
      query: { scope: "team", "drawer.open": "routingPolicy", "drawer.policyId": "rp_stale" },
      drawerOpenParam: "drawer.open",
      setQuery,
    });

    // `drawer.policyId` is gone, so a create cannot open on the policy the
    // reader was editing a moment ago; `scope` survives, because an overlay
    // opened over a filtered table must not clear the filter.
    expect(setQuery).toHaveBeenCalledWith({
      scope: "team",
      "drawer.open": "routingPolicy",
      "drawer.seedScopeType": "ORGANIZATION",
    });
  });

  it("leaves out a parameter the caller had no value for", () => {
    const setQuery = vi.fn();

    openGatewayDrawer({
      drawer: "routingPolicy",
      params: { policyId: void 0 },
      query: {},
      drawerOpenParam: "drawer.open",
      setQuery,
    });

    expect(setQuery).toHaveBeenCalledWith({ "drawer.open": "routingPolicy" });
  });
});
