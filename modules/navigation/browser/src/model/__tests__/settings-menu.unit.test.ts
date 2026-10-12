/**
 * The settings menu's gates, now that it is a function of them. It arrived as a hook that made
 * six readings for itself, which is why it had no suite: every gate needed a running
 * application to move.
 */

import { describe, expect, it } from "vitest";

import { adminMenu, settingsMenu, type SettingsMenuGates } from "../settings-menu.ts";

const EVERYTHING_CLOSED: SettingsMenuGates = {
  hasPermission: () => false,
  isSaaS: false,
  hasCloudOps: false,
  hosting: "self-hosted",
  enterprisePlan: "pending",
  isLiteMember: false,
  hasOpsAccess: false,
  isPlatformAdmin: false,
};

function hrefsIn(gates: Partial<SettingsMenuGates>): string[] {
  return settingsMenu({ ...EVERYTHING_CLOSED, ...gates }).flatMap((group) =>
    group.items.map((item) => item.href),
  );
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
      expect(adminMenu(EVERYTHING_CLOSED)).toEqual([]);
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

    /** @scenario "Authentication is offered unlocked on every plan" */
    it("offers Authentication unlocked whatever the plan says", () => {
      for (const enterprisePlan of ["pending", "locked", "included"] as const) {
        const authentication = settingsMenu({
          ...EVERYTHING_CLOSED,
          enterprisePlan,
          hasPermission: (p) => p === "sso:view",
        })
          .flatMap((group) => group.items)
          .find((item) => item.href === "/settings/authentication");
        expect(authentication).toBeDefined();
        expect(authentication?.isLocked).toBeUndefined();
      }
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
      const hrefs = hrefsIn({ enterprisePlan: "included" });
      expect(hrefs).toContain("/settings/roles");
      expect(hrefs).not.toContain("/settings/role-bindings");
    });

    it("offers Directory on every plan, in place of Members, Teams, Groups and SCIM", () => {
      for (const enterprisePlan of ["pending", "locked", "included"] as const) {
        const hrefs = hrefsIn({ enterprisePlan });
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
      expect(hrefsIn({ enterprisePlan: "included" })).not.toContain("/settings/authentication");
      expect(
        hrefsIn({ enterprisePlan: "included", hasPermission: (p) => p === "sso:view" }),
      ).toContain("/settings/authentication");
    });

    it("marks none of them locked", () => {
      const items = settingsMenu({
        ...EVERYTHING_CLOSED,
        hasPermission: () => true,
        enterprisePlan: "included",
      }).flatMap((group) => group.items);
      expect(items.filter((item) => item.isLocked)).toEqual([]);
    });

    it("still withholds the audit log without the grant that reads it", () => {
      expect(hrefsIn({ enterprisePlan: "included" })).not.toContain("/settings/audit-log");
      expect(
        hrefsIn({ enterprisePlan: "included", hasPermission: (p) => p === "auditLog:view" }),
      ).toContain("/settings/audit-log");
    });
  });
});

describe("given a plan that lacks Enterprise", () => {
  function lockedHrefsIn(gates: Partial<SettingsMenuGates>): string[] {
    return settingsMenu({ ...EVERYTHING_CLOSED, enterprisePlan: "locked", ...gates })
      .flatMap((group) => group.items)
      .filter((item) => item.isLocked)
      .map((item) => item.href);
  }

  describe("when the menu is built", () => {
    /** @scenario "A plan without Enterprise sees its entries locked" */
    it("offers the enterprise entries locked", () => {
      expect(lockedHrefsIn({ hasPermission: () => true })).toEqual([
        "/settings/audit-log",
        "/settings/roles",
      ]);
    });

    /** @scenario "A plan without Enterprise sees its entries locked" */
    it("still hides an entry the reader lacks the permission for", () => {
      expect(lockedHrefsIn({})).toEqual(["/settings/roles"]);
      expect(lockedHrefsIn({ hasPermission: (p) => p === "auditLog:view" })).toEqual([
        "/settings/audit-log",
        "/settings/roles",
      ]);
    });

    /** @scenario "Authentication is offered unlocked on every plan" */
    it("offers Authentication unlocked whatever the plan says", () => {
      for (const enterprisePlan of ["pending", "locked", "included"] as const) {
        const authentication = settingsMenu({
          ...EVERYTHING_CLOSED,
          enterprisePlan,
          hasPermission: (p) => p === "sso:view",
        })
          .flatMap((group) => group.items)
          .find((item) => item.href === "/settings/authentication");
        expect(authentication).toBeDefined();
        expect(authentication?.isLocked).toBeUndefined();
      }
    });

    it("hides them from a lite member", () => {
      expect(lockedHrefsIn({ hasPermission: () => true, isLiteMember: true })).toEqual([]);
    });
  });
});

describe("given an operator", () => {
  function adminHrefsIn(gates: Partial<SettingsMenuGates>): string[] {
    return adminMenu({ ...EVERYTHING_CLOSED, ...gates }).flatMap((group) =>
      group.items.map((item) => item.href),
    );
  }
  function adminGroupIdsIn(gates: Partial<SettingsMenuGates>): string[] {
    return adminMenu({ ...EVERYTHING_CLOSED, ...gates }).map((group) => group.id);
  }

  describe("when the Settings menu is built with operations access", () => {
    /** @scenario "Settings holds no operator groups" */
    it("offers no operations page: those live in the Admin console", () => {
      const everything = { hasOpsAccess: true, isPlatformAdmin: true, hasCloudOps: true };
      expect(hrefsIn(everything).filter((href) => href.startsWith("/ops"))).toEqual([]);
    });
  });

  describe("when the Admin menu is built with operations access", () => {
    /** The Admin menu is the ONLY place the operations pages are offered in this shell. */
    it("offers Health and Tools", () => {
      expect(adminGroupIdsIn({ hasOpsAccess: true })).toEqual(["admin-health", "admin-tools"]);
      expect(adminHrefsIn({ hasOpsAccess: true })).toContain("/ops/event-sourcing");
    });

    /** @scenario "Self-hosted installs do not offer the Feature Flags page" */
    it("offers Feature flags only where ops offers cloud ops", () => {
      expect(adminHrefsIn({ hasOpsAccess: true })).not.toContain("/ops/feature-flags");
      expect(adminHrefsIn({ hasOpsAccess: true, hasCloudOps: true })).toContain(
        "/ops/feature-flags",
      );
    });

    /** @scenario "A developer's local stack offers the Feature Flags page" */
    it("offers Feature flags on a local development stack without cloud ops", () => {
      expect(adminHrefsIn({ hasOpsAccess: true, hosting: "local" })).toContain(
        "/ops/feature-flags",
      );
    });

    it("offers instance administration only to a platform administrator", () => {
      expect(adminGroupIdsIn({ hasOpsAccess: true })).not.toContain("admin-instance");
      expect(adminGroupIdsIn({ hasOpsAccess: true, isPlatformAdmin: true })).toContain(
        "admin-instance",
      );
      expect(adminHrefsIn({ hasOpsAccess: true, isPlatformAdmin: true })).toContain("/ops/users");
    });

    it("offers Cloud only to a platform administrator where ops offers cloud ops", () => {
      const admin = { hasOpsAccess: true, isPlatformAdmin: true };
      expect(adminGroupIdsIn(admin)).not.toContain("admin-cloud");
      expect(adminGroupIdsIn({ ...admin, isSaaS: true })).not.toContain("admin-cloud");
      expect(adminGroupIdsIn({ ...admin, hasCloudOps: true })).toContain("admin-cloud");
      expect(adminGroupIdsIn({ hasOpsAccess: true, hasCloudOps: true })).not.toContain(
        "admin-cloud",
      );
      expect(adminHrefsIn({ ...admin, hasCloudOps: true })).toContain("/ops/cloud/licenses");
    });

    it("gives every entry an icon no other entry wears", () => {
      const everything = { hasOpsAccess: true, isPlatformAdmin: true, hasCloudOps: true };
      const icons = adminMenu({ ...EVERYTHING_CLOSED, ...everything }).flatMap((group) =>
        group.items.map((item) => item.icon),
      );
      expect(new Set(icons).size).toBe(icons.length);
    });
  });
});

describe("given every Settings entry", () => {
  it("gives every entry an icon no other entry wears", () => {
    const icons = settingsMenu({
      ...EVERYTHING_CLOSED,
      hasPermission: () => true,
      enterprisePlan: "included",
    }).flatMap((group) => group.items.map((item) => item.icon));
    expect(new Set(icons).size).toBe(icons.length);
  });
});
