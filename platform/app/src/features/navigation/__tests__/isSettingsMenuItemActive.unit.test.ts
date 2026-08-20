import { KeyRound, Repeat, Settings2, Users } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import {
  isSettingsMenuItemActive,
  type SettingsMenuItem,
} from "../useSettingsMenu";

// The unit lane stubs the compat router, so the real resolver is asked for
// by name. It is what turns an address into the route pattern below.
const { resolvePathname } = await vi.importActual<
  typeof import("~/utils/compat/next-router")
>("~/utils/compat/next-router");

/**
 * Which settings entry the sidebar marks as the page on screen.
 *
 * Spec: specs/navigation/settings-shell-v2.feature
 */
const GENERAL: SettingsMenuItem = {
  label: "General",
  href: "/settings",
  isExactMatch: true,
  icon: Settings2,
};
const API_KEYS: SettingsMenuItem = {
  label: "API Keys",
  href: "/settings/api-keys",
  icon: KeyRound,
};
const MEMBERS: SettingsMenuItem = {
  label: "Members",
  href: "/settings/members",
  includePath: "/settings/members",
  icon: Users,
};
const PROJECTIONS: SettingsMenuItem = {
  label: "Projection Replay",
  href: "/ops/projections",
  alsoActiveAt: ["/ops/replay"],
  icon: Repeat,
};

describe("isSettingsMenuItemActive", () => {
  describe("when the address of the page on screen is passed", () => {
    it("marks the entry the address belongs to", () => {
      expect(
        isSettingsMenuItemActive({
          item: API_KEYS,
          pathname: "/settings/api-keys",
        }),
      ).toBe(true);
    });

    it("leaves the other entries unmarked", () => {
      expect(
        isSettingsMenuItemActive({
          item: MEMBERS,
          pathname: "/settings/api-keys",
        }),
      ).toBe(false);
    });

    it("marks an entry from a page below it", () => {
      expect(
        isSettingsMenuItemActive({
          item: MEMBERS,
          pathname: "/settings/members/member-1",
        }),
      ).toBe(true);
    });

    it("does not mark an entry whose address is only a name prefix", () => {
      expect(
        isSettingsMenuItemActive({
          item: MEMBERS,
          pathname: "/settings/members-import",
        }),
      ).toBe(false);
    });
  });

  describe("when an entry answers for more than one address", () => {
    it("marks it on the address it also answers for", () => {
      expect(
        isSettingsMenuItemActive({
          item: PROJECTIONS,
          pathname: "/ops/replay",
        }),
      ).toBe(true);
    });
  });

  describe("when an entry is one that only its own page marks", () => {
    it("marks General on the settings home", () => {
      expect(
        isSettingsMenuItemActive({ item: GENERAL, pathname: "/settings" }),
      ).toBe(true);
    });

    it("leaves General unmarked on a page below it", () => {
      expect(
        isSettingsMenuItemActive({
          item: GENERAL,
          pathname: "/settings/api-keys",
        }),
      ).toBe(false);
    });
  });

  describe("when the route pattern is passed in place of the address", () => {
    /**
     * What the bug was. The compat router registers one `/settings/*`
     * pattern, so it reports the same pathname for every settings page but
     * General and Audit Log, and no entry could match it.
     */
    /** @scenario The menu marks the page that is open */
    it("matches no entry, which is why the address is what gets passed", () => {
      const pattern = resolvePathname("/settings/api-keys");

      expect(pattern).toBe("/settings/[[...path]]");
      expect(
        isSettingsMenuItemActive({ item: API_KEYS, pathname: pattern }),
      ).toBe(false);
    });
  });
});
