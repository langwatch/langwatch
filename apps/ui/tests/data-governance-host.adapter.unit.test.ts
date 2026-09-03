/**
 * The two data-governance host adapters, as value objects.
 *
 * The adapters are the whole of what the two packages know about this
 * application, so what matters is that each question is answered from the
 * reading it was given and each action is passed straight through. There is no
 * fetching to test — the reads live in the provider that constructs these.
 */

import { describe, expect, it, vi } from "vitest";
import {
  DATA_PRIVACY_PAGE_PERMISSION,
  UiDataPrivacyHost,
} from "../src/features/data-privacy/behavior/data-privacy-host.adapter";
import {
  DATA_RETENTION_PAGE_PERMISSION,
  UiDataRetentionHost,
} from "../src/features/data-retention/behavior/data-retention-host.adapter";

const availableScopes = {
  organization: { id: "org_1", name: "Acme" },
  teams: [{ id: "team_1", name: "Platform" }],
  projects: [{ id: "project_1", name: "Web App", teamId: "team_1" }],
};

function retentionHost(
  overrides: {
    isPlatformAdmin?: boolean;
    isEnterprise?: boolean;
    grants?: readonly string[];
  } = {},
) {
  const setQuery = vi.fn();
  const succeeded = vi.fn();
  const failed = vi.fn();
  const host = UiDataRetentionHost.create(
    {
      scope: { organizationId: "org_1", teamId: "team_1", projectId: "project_1" },
      availableScopes,
      isPlatformAdmin: overrides.isPlatformAdmin ?? false,
      isEnterprise: overrides.isEnterprise ?? false,
      route: { params: {}, query: { scope: "TEAM:team_1" } },
    },
    {
      hasPermission: (permission) => (overrides.grants ?? []).includes(permission),
      setQuery,
      succeeded,
      failed,
    },
  );
  return { host, setQuery, succeeded, failed };
}

describe("given the retention host adapter", () => {
  describe("when the screen asks what it is about", () => {
    it("answers the scope, the visible scopes and the address it was given", () => {
      const { host } = retentionHost();

      expect(host.scope()).toEqual({
        organizationId: "org_1",
        teamId: "team_1",
        projectId: "project_1",
      });
      expect(host.availableScopes()).toBe(availableScopes);
      expect(host.route()).toEqual({ params: {}, query: { scope: "TEAM:team_1" } });
    });
  });

  describe("when the screen asks whether the reader may disable retention", () => {
    it("answers the platform-admin flag, which is not a permission", () => {
      expect(retentionHost().host.isPlatformAdmin()).toBe(false);
      expect(retentionHost({ isPlatformAdmin: true }).host.isPlatformAdmin()).toBe(true);
      // And it is genuinely separate from the page's own grant: holding
      // `project:view` is not holding platform administration.
      expect(retentionHost({ grants: ["project:view"] }).host.isPlatformAdmin()).toBe(false);
    });
  });

  describe("when the screen asks which retention menu to offer", () => {
    it("answers the plan tier", () => {
      expect(retentionHost().host.isEnterprise()).toBe(false);
      expect(retentionHost({ isEnterprise: true }).host.isEnterprise()).toBe(true);
    });
  });

  describe("when the screen asks about a grant", () => {
    it("passes the name through and answers fail-closed", () => {
      const { host } = retentionHost({ grants: ["project:view"] });

      expect(host.hasPermission(DATA_RETENTION_PAGE_PERMISSION)).toBe(true);
      expect(host.hasPermission("project:update")).toBe(false);
    });
  });

  describe("when the screen writes the address or reports an outcome", () => {
    it("hands each one to the capability unchanged", () => {
      const { host, setQuery, succeeded, failed } = retentionHost();
      const error = new Error("nope");

      host.setQuery({ scope: void 0 }, { replace: true });
      host.succeeded({ title: "Retention policy saved" });
      host.failed({ error, fallbackTitle: "Couldn't save the retention policy" });

      expect(setQuery).toHaveBeenCalledWith({ scope: void 0 }, { replace: true });
      expect(succeeded).toHaveBeenCalledWith({ title: "Retention policy saved" });
      expect(failed).toHaveBeenCalledWith({
        error,
        fallbackTitle: "Couldn't save the retention policy",
      });
    });
  });
});

describe("given the privacy host adapter", () => {
  describe("when the screen asks what it is about", () => {
    it("answers the scope and the address it was given", () => {
      const host = UiDataPrivacyHost.create(
        {
          scope: { organizationId: "org_1", teamId: "team_1", projectId: "project_1" },
          route: { params: {}, query: { rule: "TEAM:team_1:false" } },
        },
        { setQuery: vi.fn(), succeeded: vi.fn(), failed: vi.fn() },
      );

      expect(host.scope().projectId).toBe("project_1");
      expect(host.route().query.rule).toBe("TEAM:team_1:false");
    });
  });

  describe("when the screen writes the address or reports an outcome", () => {
    it("hands each one to the capability unchanged", () => {
      const setQuery = vi.fn();
      const succeeded = vi.fn();
      const failed = vi.fn();
      const error = new Error("nope");
      const host = UiDataPrivacyHost.create(
        {
          scope: { organizationId: "org_1", teamId: "team_1", projectId: "project_1" },
          route: { params: {}, query: {} },
        },
        { setQuery, succeeded, failed },
      );

      host.setQuery({ rule: "new" });
      host.succeeded({ title: "Privacy rule saved" });
      host.failed({ error, fallbackTitle: "Couldn't save the privacy rule" });

      expect(setQuery).toHaveBeenCalledWith({ rule: "new" }, void 0);
      expect(succeeded).toHaveBeenCalledWith({ title: "Privacy rule saved" });
      expect(failed).toHaveBeenCalledWith({
        error,
        fallbackTitle: "Couldn't save the privacy rule",
      });
    });
  });

  describe("when the two pages state their grant", () => {
    it("names the one both platform pages asked for", () => {
      expect(DATA_RETENTION_PAGE_PERMISSION).toBe("project:view");
      expect(DATA_PRIVACY_PAGE_PERMISSION).toBe("project:view");
    });
  });
});
