/**
 * The settings menu's gates, now that it is a function of them. It arrived as a hook that made
 * six readings for itself, which is why it had no suite: every gate needed a running
 * application to move.
 */

import { describe, expect, it } from "vitest";

import { settingsMenu, type SettingsMenuGates } from "../settings-menu.ts";

const EVERYTHING_CLOSED: SettingsMenuGates = {
  hasPermission: () => false,
  isSaaS: false,
  showEnterpriseNav: false,
  isLiteMember: false,
  hasOpsAccess: false,
  isPlatformAdmin: false,
};

function hrefsIn(gates: Partial<SettingsMenuGates>): string[] {
  return settingsMenu({ ...EVERYTHING_CLOSED, ...gates }).flatMap((group) =>
    group.items.map((item) => item.href),
  );
}

function groupIdsIn(gates: Partial<SettingsMenuGates>): string[] {
  return settingsMenu({ ...EVERYTHING_CLOSED, ...gates }).map((group) => group.id);
}

describe("given a reader with no grants on a self-hosted deployment", () => {
  describe("when the menu is built", () => {
    it("opens with the reader's own Profile and Security pages", () => {
      const [first] = settingsMenu(EVERYTHING_CLOSED);
      expect(first?.id).toBe("settings-you");
      expect(first?.items.map((item) => item.href)).toEqual([
        "/settings/profile",
        "/settings/security",
      ]);
    });

    it("offers the license page rather than the subscription one", () => {
      expect(hrefsIn({})).toContain("/settings/license");
      expect(hrefsIn({})).not.toContain("/settings/subscription");
    });

    it("offers neither the operations nor its admin groups", () => {
      expect(groupIdsIn({})).not.toContain("settings-ops");
      expect(groupIdsIn({})).not.toContain("settings-ops-instance");
      expect(groupIdsIn({})).not.toContain("settings-cloud-admin");
    });
  });
});

describe("given a self-hosted install", () => {
  describe("when the menu is built", () => {
    /** @scenario "The checkup page is listed beside License and Connect on a self-hosted install" */
    it("lists Checkup with License and Connect, and none of them on LangWatch Cloud", () => {
      const install = ["/settings/license", "/settings/connect", "/settings/checkup"];
      const selfHosted = hrefsIn({});
      expect(selfHosted.filter((href) => install.includes(href))).toEqual(install);
      expect(hrefsIn({ isSaaS: true }).filter((href) => install.includes(href))).toEqual([]);
    });

    it("hides them from a lite member", () => {
      const install = ["/settings/license", "/settings/connect", "/settings/checkup"];
      expect(hrefsIn({ isLiteMember: true }).filter((href) => install.includes(href))).toEqual([]);
    });
  });
});

describe("given the hosted product", () => {
  describe("when the menu is built", () => {
    it("offers the subscription page rather than the license one", () => {
      expect(hrefsIn({ isSaaS: true })).toContain("/settings/subscription");
      expect(hrefsIn({ isSaaS: true })).not.toContain("/settings/license");
    });
  });
});

describe("given a lite member", () => {
  describe("when the menu is built", () => {
    /**
     * The role that reads every settings page and writes none of them. It keeps
     * the pages it can act on and loses the ones that are somebody else's
     * account: keys, billing and the secret store.
     */
    it("loses the account pages a lite member cannot act on", () => {
      const hrefs = hrefsIn({ isLiteMember: true });
      expect(hrefs).not.toContain("/settings/api-keys");
      expect(hrefs).not.toContain("/settings/usage");
      expect(hrefs).not.toContain("/settings/secrets");
      expect(hrefs).not.toContain("/settings/topic-clustering");
    });

    it("keeps the pages that are not", () => {
      const hrefs = hrefsIn({ isLiteMember: true, hasPermission: () => true });
      expect(hrefs).toContain("/settings/profile");
      expect(hrefs).toContain("/settings/security");
      expect(hrefs).toContain("/settings/model-providers");
      expect(hrefs).not.toContain("/settings/authentication");
    });
  });
});

describe("given an enterprise plan", () => {
  describe("when the menu is built with the enterprise entries shown", () => {
    it("offers the enterprise access entries", () => {
      const hrefs = hrefsIn({ showEnterpriseNav: true });
      expect(hrefs).toContain("/settings/roles");
      expect(hrefs).not.toContain("/settings/role-bindings");
    });

    it("offers Directory on every plan, in place of Members, Teams, Groups and SCIM", () => {
      for (const showEnterpriseNav of [false, true]) {
        const hrefs = hrefsIn({ showEnterpriseNav });
        expect(hrefs).toContain("/settings/directory");
        for (const old of [
          "/settings/members",
          "/settings/teams",
          "/settings/groups",
          "/settings/scim",
        ]) {
          expect(hrefs).not.toContain(old);
        }
      }
    });

    it("offers Authentication only to a reader who may see single sign-on", () => {
      expect(hrefsIn({ showEnterpriseNav: true })).not.toContain("/settings/authentication");
      expect(
        hrefsIn({ showEnterpriseNav: true, hasPermission: (p) => p === "sso:view" }),
      ).toContain("/settings/authentication");
      expect(hrefsIn({ hasPermission: (p) => p === "sso:view" })).not.toContain(
        "/settings/authentication",
      );
    });

    it("still withholds the audit log without the grant that reads it", () => {
      expect(hrefsIn({ showEnterpriseNav: true })).not.toContain("/settings/audit-log");
      expect(
        hrefsIn({ showEnterpriseNav: true, hasPermission: (p) => p === "auditLog:view" }),
      ).toContain("/settings/audit-log");
    });
  });
});

describe("given an operator", () => {
  describe("when the menu is built with operations access", () => {
    /**
     * This menu is the ONLY place the operations pages are offered in this
     * shell, so a page missing from the group cannot be reached from the menu
     * at all.
     */
    it("offers the operations group", () => {
      expect(groupIdsIn({ hasOpsAccess: true })).toContain("settings-ops");
      expect(hrefsIn({ hasOpsAccess: true })).toContain("/ops/event-sourcing");
    });

    it("offers instance administration only to a platform administrator", () => {
      expect(groupIdsIn({ hasOpsAccess: true })).not.toContain("settings-ops-instance");
      expect(groupIdsIn({ hasOpsAccess: true, isPlatformAdmin: true })).toContain(
        "settings-ops-instance",
      );
      expect(hrefsIn({ hasOpsAccess: true, isPlatformAdmin: true })).toContain("/ops/users");
    });

    it("offers Cloud admin only to a platform administrator on SaaS", () => {
      const admin = { hasOpsAccess: true, isPlatformAdmin: true };
      expect(groupIdsIn(admin)).not.toContain("settings-cloud-admin");
      expect(groupIdsIn({ ...admin, isSaaS: true })).toContain("settings-cloud-admin");
      expect(groupIdsIn({ hasOpsAccess: true, isSaaS: true })).not.toContain(
        "settings-cloud-admin",
      );
      expect(hrefsIn({ ...admin, isSaaS: true })).toContain("/ops/cloud/licenses");
    });
  });
});
