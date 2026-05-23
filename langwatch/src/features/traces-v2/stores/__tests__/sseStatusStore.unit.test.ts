// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LIVE_UPDATES_STORAGE_KEY = "langwatch:traces-v2:live-updates-mode:v1";
const LEGACY_LIVE_UPDATES_BOOL_KEY =
  "langwatch:traces-v2:live-updates-enabled:v1";

/**
 * The store reads localStorage at module-load time, so each test bootstraps
 * a fresh module instance after seeding the storage it cares about.
 */
async function loadStoreWith(initial: {
  mode?: string;
  legacy?: string;
}) {
  if (initial.mode != null) {
    window.localStorage.setItem(LIVE_UPDATES_STORAGE_KEY, initial.mode);
  }
  if (initial.legacy != null) {
    window.localStorage.setItem(LEGACY_LIVE_UPDATES_BOOL_KEY, initial.legacy);
  }
  const mod = await import("../sseStatusStore");
  return mod;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  // Each test gets a fresh module instance so the read-once initial state
  // matches what the test set up.
  vi.resetModules();
  window.localStorage.clear();
});

describe("sseStatusStore", () => {
  describe("when reading the initial liveUpdatesMode", () => {
    it("defaults to 'live' on a fresh project", async () => {
      const { useSseStatusStore } = await loadStoreWith({});
      expect(useSseStatusStore.getState().liveUpdatesMode).toBe("live");
      expect(useSseStatusStore.getState().liveUpdatesEnabled).toBe(true);
    });

    it("honours an explicit persisted 'ask' choice", async () => {
      const { useSseStatusStore } = await loadStoreWith({ mode: "ask" });
      expect(useSseStatusStore.getState().liveUpdatesMode).toBe("ask");
      expect(useSseStatusStore.getState().liveUpdatesEnabled).toBe(true);
    });

    it("honours an explicit persisted 'paused' choice", async () => {
      const { useSseStatusStore } = await loadStoreWith({ mode: "paused" });
      expect(useSseStatusStore.getState().liveUpdatesMode).toBe("paused");
      expect(useSseStatusStore.getState().liveUpdatesEnabled).toBe(false);
      expect(useSseStatusStore.getState().sseConnectionState).toBe(
        "disconnected",
      );
    });

    it("migrates the legacy boolean 'false' → 'paused'", async () => {
      const { useSseStatusStore } = await loadStoreWith({ legacy: "false" });
      expect(useSseStatusStore.getState().liveUpdatesMode).toBe("paused");
    });

    it("migrates the legacy boolean 'true' (or anything truthy) → 'live'", async () => {
      const { useSseStatusStore } = await loadStoreWith({ legacy: "true" });
      expect(useSseStatusStore.getState().liveUpdatesMode).toBe("live");
    });

    it("ignores garbage in the v1 key and falls through to legacy migration", async () => {
      const { useSseStatusStore } = await loadStoreWith({
        mode: "nonsense",
        legacy: "false",
      });
      expect(useSseStatusStore.getState().liveUpdatesMode).toBe("paused");
    });
  });

  describe("when toggling the mode", () => {
    it("cycles live → ask → paused → live", async () => {
      const { useSseStatusStore } = await loadStoreWith({ mode: "live" });
      const toggle = useSseStatusStore.getState().toggleLiveUpdates;
      toggle();
      expect(useSseStatusStore.getState().liveUpdatesMode).toBe("ask");
      toggle();
      expect(useSseStatusStore.getState().liveUpdatesMode).toBe("paused");
      toggle();
      expect(useSseStatusStore.getState().liveUpdatesMode).toBe("live");
    });

    it("persists each step so a reload resumes mid-cycle", async () => {
      const { useSseStatusStore } = await loadStoreWith({ mode: "live" });
      useSseStatusStore.getState().toggleLiveUpdates(); // → ask
      expect(window.localStorage.getItem(LIVE_UPDATES_STORAGE_KEY)).toBe("ask");
      // Keep the legacy boolean roughly in sync so old consumers reading
      // the original key still see something sensible.
      expect(
        window.localStorage.getItem(LEGACY_LIVE_UPDATES_BOOL_KEY),
      ).toBe("true");

      useSseStatusStore.getState().toggleLiveUpdates(); // → paused
      expect(window.localStorage.getItem(LIVE_UPDATES_STORAGE_KEY)).toBe(
        "paused",
      );
      expect(
        window.localStorage.getItem(LEGACY_LIVE_UPDATES_BOOL_KEY),
      ).toBe("false");
    });

    it("flips sseConnectionState to disconnected when paused, connecting otherwise", async () => {
      const { useSseStatusStore } = await loadStoreWith({ mode: "live" });
      useSseStatusStore.getState().setLiveUpdatesMode("paused");
      expect(useSseStatusStore.getState().sseConnectionState).toBe(
        "disconnected",
      );
      useSseStatusStore.getState().setLiveUpdatesMode("ask");
      expect(useSseStatusStore.getState().sseConnectionState).toBe(
        "connecting",
      );
    });

  });
});
