import { describe, expect, it } from "vitest";
import {
  buildRetentionMenuItems,
  CUSTOM_PRESET_VALUE,
  INDEFINITE_PRESET_VALUE,
  LEGACY_PRESET_VALUE,
} from "../constants";

const labels = (items: { label: string }[]) => items.map((i) => i.label);
const values = (items: { value: string }[]) => items.map((i) => i.value);

describe("buildRetentionMenuItems", () => {
  describe("given a paid (non-enterprise) org", () => {
    const items = buildRetentionMenuItems({
      isEnterprise: false,
      isPlatformAdmin: false,
      legacyDays: null,
    });

    it("offers exactly the two fixed presets, in order", () => {
      expect(labels(items)).toEqual(["1 month", "2 months"]);
    });

    it("offers no custom option", () => {
      expect(values(items)).not.toContain(CUSTOM_PRESET_VALUE);
    });

    it("offers no keep-forever option", () => {
      expect(values(items)).not.toContain(INDEFINITE_PRESET_VALUE);
    });
  });

  describe("given an enterprise org", () => {
    const items = buildRetentionMenuItems({
      isEnterprise: true,
      isPlatformAdmin: false,
      legacyDays: null,
    });

    it("offers the full preset list plus custom", () => {
      expect(labels(items)).toEqual([
        "1 month",
        "2 months",
        "3 months",
        "1 year",
        "5 years",
        "Custom…",
      ]);
    });

    it("does not offer keep-forever to a non-admin", () => {
      expect(values(items)).not.toContain(INDEFINITE_PRESET_VALUE);
    });
  });

  describe("given a platform admin", () => {
    it("adds keep-forever before the custom option", () => {
      const items = buildRetentionMenuItems({
        isEnterprise: true,
        isPlatformAdmin: true,
        legacyDays: null,
      });
      expect(values(items)).toContain(INDEFINITE_PRESET_VALUE);
      // Custom stays last so keep-forever doesn't hide beneath it.
      expect(values(items).at(-1)).toBe(CUSTOM_PRESET_VALUE);
    });
  });

  describe("given a grandfathered out-of-menu value being edited", () => {
    it("prepends a read-only 'current (legacy)' entry showing the stored days", () => {
      const items = buildRetentionMenuItems({
        isEnterprise: false,
        isPlatformAdmin: false,
        legacyDays: 371,
      });
      expect(items[0]).toEqual({
        value: LEGACY_PRESET_VALUE,
        label: "Current: 371 days (legacy)",
      });
      // The real plan options still follow.
      expect(labels(items).slice(1)).toEqual(["1 month", "2 months"]);
    });

    it("labels an indefinite legacy value as keep-forever", () => {
      const items = buildRetentionMenuItems({
        isEnterprise: false,
        isPlatformAdmin: false,
        legacyDays: 0,
      });
      expect(items[0]?.label).toBe("Current: keep forever (legacy)");
    });
  });
});
