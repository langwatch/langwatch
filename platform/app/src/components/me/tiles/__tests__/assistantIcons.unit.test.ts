import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ASSISTANT_KINDS,
  ASSISTANT_OPTIONS,
  ASSISTANT_PRESETS,
} from "../assistantIcons";

/**
 * The tool tile's assistant picker. `ASSISTANT_OPTIONS` is what the drawer
 * renders and `ASSISTANT_KINDS` is what the drawer's own gate accepts, so a
 * kind missing from either is a kind an organisation cannot govern.
 *
 * Spec: specs/coding-agent/pi-session-capture.feature
 */
describe("the coding-assistant tile picker", () => {
  describe("when the list of kinds the tile offers is read", () => {
    /** @scenario "The tool tile offers pi" */
    it("offers pi", () => {
      expect(ASSISTANT_OPTIONS.map((o) => o.value)).toContain("pi");
    });

    it("accepts pi as a kind, so the drawer's gate does not refuse its own option", () => {
      expect(ASSISTANT_KINDS as readonly string[]).toContain("pi");
    });
  });

  describe("when pi's preset is read", () => {
    it("names pi and points at pi's own mark", () => {
      expect(ASSISTANT_PRESETS.pi).toEqual({
        label: "pi",
        iconUrl: "/images/external-icons/pi.svg",
        darkModeInvert: false,
      });
    });
  });

  /**
   * An `iconUrl` is a public path the browser fetches, so a wrong one fails as
   * a broken image at render rather than as anything a type or a unit test
   * would notice. Resolving each one against `public/` is the only check that
   * actually observes that failure.
   */
  describe("when the icon each preset points at is resolved on disk", () => {
    const publicDir = join(__dirname, "..", "..", "..", "..", "..", "public");

    const presetsWithIcons = (
      Object.entries(ASSISTANT_PRESETS) as Array<
        [string, (typeof ASSISTANT_PRESETS)[keyof typeof ASSISTANT_PRESETS]]
      >
    ).filter(([, preset]) => preset.iconUrl !== null);

    it.each(presetsWithIcons)("finds the file %s names", (_kind, preset) => {
      expect(existsSync(join(publicDir, preset.iconUrl!))).toBe(true);
    });
  });
});
