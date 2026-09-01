/**
 * The harvested settings menu, against the platform menu it was copied from.
 *
 * The whole risk of harvesting `SettingsLayout` into `apps/ui` is a silently
 * dropped link: a settings page whose entry disappears is unreachable for
 * anyone who navigates rather than types, and nothing else in the product would
 * notice. So the list is data, and this file pins it — every address the
 * platform layout offers, under the gates that decide whether it is offered.
 *
 * THE ADDRESSES OF PAGES THAT HAVE NOT MOVED ARE HERE ON PURPOSE. An entry is
 * an href, not a loader; `platform/app` still serves twenty-odd of these and
 * the URLs are unchanged, so the menu is complete regardless of which half of
 * the product renders the page behind it.
 */

import { describe, expect, it } from "vitest";
import {
  isUiSettingsMenuGroupActive,
  isUiSettingsMenuItemActive,
  uiSettingsMenu,
  type UiSettingsMenuGates,
} from "../src/model/ui-settings-menu";

const NOTHING_GRANTED: UiSettingsMenuGates = {
  hasPermission: () => false,
  isSaaS: false,
  showEnterpriseNav: false,
  isLiteMember: false,
  hasOpsAccess: false,
  isOpsAdmin: false,
};

function addresses(gates: Partial<UiSettingsMenuGates> = {}): string[] {
  const menu = uiSettingsMenu({ ...NOTHING_GRANTED, ...gates });
  return [
    ...menu.top.map((item) => item.href),
    ...menu.groups.flatMap((group) => group.items.map((item) => item.href)),
  ];
}

describe("given a member on a self-hosted deployment with no enterprise plan", () => {
  describe("when the settings menu is built", () => {
    it("offers exactly the addresses the platform layout offered them", () => {
      expect(addresses()).toEqual([
        "/settings",
        "/settings/api-keys",
        "/settings/model-providers",
        "/settings/model-costs",
        "/settings/secrets",
        "/settings/members",
        "/settings/teams",
        "/settings/authentication",
        "/settings/data-retention",
        "/settings/data-privacy",
        "/settings/annotation-scores",
        "/settings/topic-clustering",
        "/settings/integrations",
        "/settings/usage",
        "/settings/license",
      ]);
    });

    it("groups them the way the platform layout grouped them", () => {
      expect(uiSettingsMenu(NOTHING_GRANTED).groups.map((group) => group.label)).toEqual([
        "Models",
        "Teams & Access",
        "Features",
        "Billing",
      ]);
    });
  });
});

describe("given the gates that add or remove an entry", () => {
  describe("when the deployment is the hosted product", () => {
    it("offers Subscription instead of License", () => {
      expect(addresses({ isSaaS: true })).toContain("/settings/subscription");
      expect(addresses({ isSaaS: true })).not.toContain("/settings/license");
    });
  });

  describe("when the organization is on the enterprise plan", () => {
    it("adds the four enterprise access entries", () => {
      expect(addresses({ showEnterpriseNav: true })).toEqual(
        expect.arrayContaining([
          "/settings/groups",
          "/settings/roles",
          "/settings/scim",
          "/settings/role-bindings",
        ]),
      );
    });

    it("adds the audit log only to a reader who may read it", () => {
      expect(addresses({ showEnterpriseNav: true })).not.toContain("/settings/audit-log");
      expect(
        addresses({
          showEnterpriseNav: true,
          hasPermission: (permission) => permission === "auditLog:view",
        }),
      ).toContain("/settings/audit-log");
    });
  });

  describe("when the reader may read automations", () => {
    it("adds email suppressions, which is the only entry that grant opens", () => {
      expect(addresses()).not.toContain("/settings/email-suppressions");
      expect(
        addresses({ hasPermission: (permission) => permission === "triggers:view" }),
      ).toContain("/settings/email-suppressions");
    });
  });

  describe("when the reader is a lite member", () => {
    it("takes away keys, secrets, topic clustering and the whole billing group", () => {
      const lite = addresses({ isLiteMember: true, showEnterpriseNav: true });

      expect(lite).not.toContain("/settings/api-keys");
      expect(lite).not.toContain("/settings/secrets");
      expect(lite).not.toContain("/settings/topic-clustering");
      expect(lite).not.toContain("/settings/usage");
      expect(lite).not.toContain("/settings/groups");
      expect(lite).toContain("/settings/data-privacy");
    });
  });

  describe("when the reader holds the operator grants", () => {
    it("adds the operator workspace under ops:view", () => {
      const menu = uiSettingsMenu({ ...NOTHING_GRANTED, hasOpsAccess: true });

      expect(menu.groups.map((group) => group.label)).toContain("Ops");
      expect(menu.groups.map((group) => group.label)).not.toContain("Backoffice");
    });

    it("keeps the Backoffice behind the narrower grant, decoupled from the workspace", () => {
      const operator = uiSettingsMenu({ ...NOTHING_GRANTED, hasOpsAccess: true });
      const admin = uiSettingsMenu({
        ...NOTHING_GRANTED,
        hasOpsAccess: true,
        isOpsAdmin: true,
      });

      expect(operator.groups.map((group) => group.label)).not.toContain("Backoffice");
      expect(admin.groups.map((group) => group.label)).toContain("Backoffice");
    });
  });
});

describe("given a reader looking at one of the settings pages", () => {
  describe("when the address is the entry's own", () => {
    it("marks it active", () => {
      expect(
        isUiSettingsMenuItemActive({
          item: { label: "Data Privacy", href: "/settings/data-privacy" },
          pathname: "/settings/data-privacy",
        }),
      ).toBe(true);
    });
  });

  describe("when the entry owns a subtree", () => {
    it("marks it active for an address inside it", () => {
      expect(
        isUiSettingsMenuItemActive({
          item: {
            label: "Payload store",
            href: "/ops/blobs",
            includePath: "/ops/blobs",
          },
          pathname: "/ops/blobs/abc123",
        }),
      ).toBe(true);
    });
  });

  describe("when the address is inside a group", () => {
    it("opens that group and no other", () => {
      const menu = uiSettingsMenu(NOTHING_GRANTED);
      const open = menu.groups.filter((group) =>
        isUiSettingsMenuGroupActive({ group, pathname: "/settings/data-retention" }),
      );

      expect(open.map((group) => group.label)).toEqual(["Features"]);
    });
  });
});
