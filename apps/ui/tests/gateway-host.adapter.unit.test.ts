/**
 * The gateway package's host port, answered from this application.
 *
 * The adapter is a value object over readings that have already happened, which
 * is what makes it assertable without a router, a transport or a document. What
 * is worth pinning is the three decisions it makes rather than forwards: which
 * organization this page is about, and which project and team the address is
 * standing in — all three resolved out of the graph already in hand rather than
 * asked for again — and the ADDRESS IT SPELLS for a registered drawer, which is
 * the half `@langwatch/gateway-web` deliberately does not state: its screens
 * name a drawer and record the request, and this is where that becomes
 * `?drawer.open=`.
 */

import { describe, expect, it, vi } from "vitest";
import {
  DRAWER_OPEN_PARAM,
  UiGatewayHost,
} from "../src/features/gateway/behavior/gateway-host.adapter";

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

function host({
  organizationId = "org_acme",
  projectId = null,
  query = {},
  actions = {},
}: {
  organizationId?: string | null;
  projectId?: string | null;
  query?: Readonly<Record<string, string | undefined>>;
  actions?: Partial<Parameters<typeof UiGatewayHost.create>[1]>;
} = {}) {
  return UiGatewayHost.create(
    {
      scope: { organizationId, projectId },
      organizations: [ACME, OTHER],
      currentUser: { id: "user_1", name: "Ada", email: "ada@acme.example" },
      plan: { isEnterprise: false, webhookEndpointsEnabled: false, isLoading: false },
      deployment: {
        isSaas: true,
        appBaseUrl: "https://app.langwatch.ai",
        gatewayBaseUrl: "https://gateway.langwatch.ai/v1",
      },
      route: { params: {}, query },
    },
    {
      hasPermission: () => false,
      isFeatureEnabled: () => false,
      setQuery: () => void 0,
      navigate: () => void 0,
      succeeded: () => void 0,
      failed: () => void 0,
      ...actions,
    },
  );
}

describe("given the gateway host adapter", () => {
  describe("when a screen asks which organization it is about", () => {
    it("resolves it out of the graph the reader can already reach", () => {
      expect(host().organization()).toBe(ACME);
    });

    it("has no answer while the scope has not resolved", () => {
      expect(host({ organizationId: null }).organization()).toBeUndefined();
    });

    it("has no answer for an organization the reader cannot reach", () => {
      expect(host({ organizationId: "org_absent" }).organization()).toBeUndefined();
    });
  });

  describe("when a screen asks which project it is standing in", () => {
    it("finds it under whichever team holds it", () => {
      expect(host({ projectId: "project_1" }).project()).toBe(CHECKOUT);
    });

    it("names the team that holds it", () => {
      expect(host({ projectId: "project_1" }).team()?.id).toBe("team_1");
    });

    it("has no answer for an address with no project in it", () => {
      const scoped = host({ projectId: null });

      expect(scoped.project()).toBeUndefined();
      expect(scoped.team()).toBeUndefined();
    });
  });

  describe("when a screen opens a registered drawer", () => {
    it("writes the drawer's name and its own parameters, prefixed", () => {
      const setQuery = vi.fn();

      host({ actions: { setQuery } }).openDrawer({
        drawer: "routingPolicy",
        params: { policyId: "rp_1" },
      });

      expect(setQuery).toHaveBeenCalledWith({
        [DRAWER_OPEN_PARAM]: "routingPolicy",
        "drawer.policyId": "rp_1",
      });
    });

    it("keeps the reader's own query and drops the previous drawer's", () => {
      const setQuery = vi.fn();

      host({
        query: { scope: "team", "drawer.open": "routingPolicy", "drawer.policyId": "rp_stale" },
        actions: { setQuery },
      }).openDrawer({ drawer: "routingPolicy", params: { seedScopeType: "ORGANIZATION" } });

      // `drawer.policyId` is gone, so a create cannot open on the policy the
      // reader was editing a moment ago; `scope` survives, because an overlay
      // opened over a filtered table must not clear the filter.
      expect(setQuery).toHaveBeenCalledWith({
        scope: "team",
        [DRAWER_OPEN_PARAM]: "routingPolicy",
        "drawer.seedScopeType": "ORGANIZATION",
      });
    });

    it("leaves out a parameter the caller had no value for", () => {
      const setQuery = vi.fn();

      host({ actions: { setQuery } }).openDrawer({
        drawer: "routingPolicy",
        params: { policyId: void 0 },
      });

      expect(setQuery).toHaveBeenCalledWith({ [DRAWER_OPEN_PARAM]: "routingPolicy" });
    });
  });

  describe("when a screen acts", () => {
    it("hands the action to the application rather than doing it", () => {
      const navigate = vi.fn();
      const failed = vi.fn();

      const acting = host({ actions: { navigate, failed } });
      acting.navigate("/gateway/budgets");
      acting.failed({ error: new Error("nope"), fallbackTitle: "Could not save" });

      expect(navigate).toHaveBeenCalledWith("/gateway/budgets");
      expect(failed).toHaveBeenCalledTimes(1);
    });
  });
});
