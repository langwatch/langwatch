// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "langwatch:graphics-quality-override:v1";

describe("graphicsQualityOverrideStore", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    vi.resetModules();
  });

  describe("when nothing is persisted yet", () => {
    it("defaults to auto", async () => {
      const { useGraphicsQualityOverrideStore } = await import(
        "../graphicsQualityOverrideStore"
      );
      expect(useGraphicsQualityOverrideStore.getState().override).toBe(
        "auto",
      );
    });
  });

  describe("when a valid choice was already persisted", () => {
    it("loads that choice instead of the default", async () => {
      localStorage.setItem(STORAGE_KEY, "on");
      const { useGraphicsQualityOverrideStore } = await import(
        "../graphicsQualityOverrideStore"
      );
      expect(useGraphicsQualityOverrideStore.getState().override).toBe("on");
    });
  });

  describe("when garbage is persisted", () => {
    it("falls back to auto instead of trusting the stored value", async () => {
      localStorage.setItem(STORAGE_KEY, "not-a-real-choice");
      const { useGraphicsQualityOverrideStore } = await import(
        "../graphicsQualityOverrideStore"
      );
      expect(useGraphicsQualityOverrideStore.getState().override).toBe(
        "auto",
      );
    });
  });

  describe("setOverride()", () => {
    it("updates the store's own state", async () => {
      const { useGraphicsQualityOverrideStore } = await import(
        "../graphicsQualityOverrideStore"
      );
      useGraphicsQualityOverrideStore.getState().setOverride("off");
      expect(useGraphicsQualityOverrideStore.getState().override).toBe(
        "off",
      );
    });

    it("persists the choice so a later load picks it up", async () => {
      const { useGraphicsQualityOverrideStore } = await import(
        "../graphicsQualityOverrideStore"
      );
      useGraphicsQualityOverrideStore.getState().setOverride("on");
      expect(localStorage.getItem(STORAGE_KEY)).toBe("on");
    });
  });
});
