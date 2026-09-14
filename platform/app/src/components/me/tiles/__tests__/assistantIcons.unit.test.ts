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
    // We ship no pi mark; `iconUrl: null` is the deliberate no-asset state and
    // both renderers fall through to the neutral coding-assistant glyph.
    it("names pi and carries no icon asset", () => {
      expect(ASSISTANT_PRESETS.pi).toEqual({
        label: "pi",
        iconUrl: null,
        darkModeInvert: false,
      });
    });
  });
});
