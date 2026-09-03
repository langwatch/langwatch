/**
 * The settings menu's gates, now that it is a function of them.
 *
 * It arrived as a hook that made six readings for itself, which is why it had
 * no suite: every gate needed a running application to move. As a pure builder
 * each one is a case, and the cases below are the ones that lose a reader a
 * page if they invert.
 */

import { describe, expect, it } from "vitest";
import { settingsMenu, type SettingsMenuGates } from "../settings-menu";

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
    it("offers the license page rather than the subscription one", () => {
      expect(hrefsIn({})).toContain("/settings/license");
      expect(hrefsIn({})).not.toContain("/settings/subscription");
    });

    it("offers neither the operations nor the backoffice group", () => {
      expect(groupIdsIn({})).not.toContain("settings-ops");
      expect(groupIdsIn({})).not.toContain("settings-backoffice");
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
      expect(hrefsIn({ isLiteMember: true })).toContain("/settings/authentication");
    });
  });
});

describe("given a plan that has not answered yet", () => {
  describe("when the menu is built with the enterprise entries shown", () => {
    /**
     * `showEnterpriseNav` is deliberately not `isEnterprise`: the entries are
     * shown WHILE the plan is arriving, so a reader on that plan never watches
     * four links appear a beat after the page.
     */
    it("offers the enterprise access entries", () => {
      const hrefs = hrefsIn({ showEnterpriseNav: true });
      expect(hrefs).toContain("/settings/groups");
      expect(hrefs).toContain("/settings/roles");
      expect(hrefs).toContain("/settings/role-bindings");
      expect(hrefs).toContain("/settings/scim");
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

    it("offers the backoffice group only to a platform administrator", () => {
      expect(groupIdsIn({ hasOpsAccess: true })).not.toContain("settings-backoffice");
      expect(groupIdsIn({ hasOpsAccess: true, isPlatformAdmin: true })).toContain(
        "settings-backoffice",
      );
    });
  });
});
