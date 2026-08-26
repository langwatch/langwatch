import { beforeEach, describe, expect, it } from "vitest";
import { usePresencePreferencesStore } from "../src/presence-preferences-store";

beforeEach(() => {
  usePresencePreferencesStore.getState().setHidden(false);
});

describe("given the presence preferences store", () => {
  describe("when the operator toggles hidden", () => {
    it("flips the hidden flag each call", () => {
      usePresencePreferencesStore.getState().toggleHidden();
      expect(usePresencePreferencesStore.getState().hidden).toBe(true);

      usePresencePreferencesStore.getState().toggleHidden();
      expect(usePresencePreferencesStore.getState().hidden).toBe(false);
    });
  });

  describe("when hidden is set explicitly", () => {
    it("stores exactly the given value", () => {
      usePresencePreferencesStore.getState().setHidden(true);
      expect(usePresencePreferencesStore.getState().hidden).toBe(true);
    });
  });
});
