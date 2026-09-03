/**
 * The governance package's host port, answered from this application.
 *
 * The adapter is a value object over readings that have already happened, which
 * is what makes it assertable without a router, a transport or a document. What
 * is worth pinning is the one decision it makes rather than forwards: which of
 * the organizations the reader can reach is the one this page is about.
 */

import { describe, expect, it, vi } from "vitest";
import { UiGovernanceHost } from "../src/features/governance/behavior/governance-host.adapter";

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

function host({
  organizationId = "org_acme",
  actions = {},
}: {
  organizationId?: string | null;
  actions?: Partial<Parameters<typeof UiGovernanceHost.create>[1]>;
} = {}) {
  return UiGovernanceHost.create(
    {
      scope: { organizationId, projectId: null },
      organizations: [ACME, OTHER],
      plan: { isEnterprise: false, isLoading: false },
      deployment: { isSaas: true, appBaseUrl: "https://app.langwatch.ai" },
      route: { params: {}, query: {} },
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

describe("given the governance host over this application's capabilities", () => {
  describe("when the page is scoped to an organization the reader can reach", () => {
    it("answers with that organization and its teams, not the first one", () => {
      expect(host({ organizationId: "org_other" }).organization()).toBe(OTHER);
      expect(host().organization()?.teams[0]?.projects[0]?.name).toBe("Checkout");
    });
  });

  describe("when the scope has not resolved an organization yet", () => {
    it("answers with nothing rather than guessing", () => {
      expect(host({ organizationId: null }).organization()).toBeUndefined();
    });
  });

  describe("when the scope names an organization the reader is not in", () => {
    it("answers with nothing rather than a mismatched row", () => {
      expect(host({ organizationId: "org_unknown" }).organization()).toBeUndefined();
    });
  });

  describe("when a screen reports how an action turned out", () => {
    it("passes the raw error through rather than a sentence it composed", () => {
      const failed = vi.fn();
      const error = new Error("boom");

      host({ actions: { failed } }).failed({ error, fallbackTitle: "Couldn't archive" });

      expect(failed).toHaveBeenCalledWith({ error, fallbackTitle: "Couldn't archive" });
    });
  });
});
