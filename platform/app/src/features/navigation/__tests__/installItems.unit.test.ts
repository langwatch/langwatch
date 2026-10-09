/**
 * The settings pages that exist only on a self-hosted install.
 *
 * Spec: specs/self-hosting/checkup/checkup.feature
 */
import { describe, expect, it } from "vitest";

import { installItems } from "../useSettingsMenu";

describe("installItems", () => {
  describe("when the settings menu is built for a self-hosted install", () => {
    /** @scenario "The checkup page is listed beside License and Connect on a self-hosted install" */
    it("lists Checkup with License and Connect, and none of them on LangWatch Cloud", () => {
      const selfHosted = installItems({ isSaaS: false, isLiteMember: false });
      expect(selfHosted.map((item) => [item.label, item.href])).toEqual([
        ["License", "/settings/license"],
        ["Connect", "/settings/connect"],
        ["Checkup", "/settings/checkup"],
      ]);

      expect(installItems({ isSaaS: true, isLiteMember: false })).toEqual([]);
    });

    it("hides them from a lite member", () => {
      expect(installItems({ isSaaS: false, isLiteMember: true })).toEqual([]);
    });
  });
});
