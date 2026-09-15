// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forceReloadOnce,
  isChunkLoadError,
  registerChunkReloadListener,
  reloadOnChunkError,
  warmChunk,
} from "../src/behavior/chunk-reload";

// jsdom locks down window.location (non-configurable, can't be deleted, redefined
// or spied), and location.reload() is a harmless no-op there. So rather than
// asserting reload() was called, we assert the observable cooldown sentinel it
// writes to sessionStorage — which is where the branching logic actually lives.
const RELOAD_AT = "chunk-reload-at";
const reloaded = () => sessionStorage.getItem(RELOAD_AT) !== null;

/**
 * The event Vite dispatches from its preload helper. `payload` is the error it
 * is about to throw, and it is the only field that says which import failed.
 */
const preloadErrorEvent = (payload: Error) =>
  Object.assign(new Event("vite:preloadError", { cancelable: true }), {
    payload,
  });

const staleChunkError = () => new Error("Failed to fetch dynamically imported module");

/** Let the listener's deferred reload decision run. */
const settleDeferredReload = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("isChunkLoadError", () => {
  describe("when the message is a Vite dynamic-import failure", () => {
    it("classifies it as a chunk-load error", () => {
      const err = new Error(
        "Failed to fetch dynamically imported module: https://app.langwatch.ai/assets/react-json-view-CugXrtI-.js",
      );
      expect(isChunkLoadError(err)).toBe(true);
    });
  });

  describe("when the message is a webpack-style loading-chunk failure", () => {
    it("classifies it as a chunk-load error", () => {
      expect(isChunkLoadError(new Error("Loading chunk 5 failed"))).toBe(true);
    });
  });

  describe("when the message is a module-script import failure", () => {
    it("classifies it as a chunk-load error", () => {
      expect(isChunkLoadError(new Error("error importing a module script failed"))).toBe(true);
    });
  });

  describe("when the error is an ordinary runtime error", () => {
    it("does not classify it as a chunk-load error", () => {
      expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    });
  });

  describe("when given a non-Error value", () => {
    it("coerces to string and does not throw", () => {
      expect(isChunkLoadError(null)).toBe(false);
      expect(isChunkLoadError("Loading chunk 1 failed")).toBe(true);
    });
  });
});

describe("forceReloadOnce", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when no reload has happened recently", () => {
    it("reloads once and records the reload time", () => {
      expect(forceReloadOnce()).toBe(true);
      expect(reloaded()).toBe(true);
    });
  });

  describe("when a reload happened within the cooldown window", () => {
    it("does not reload again", () => {
      forceReloadOnce();
      vi.advanceTimersByTime(5_000); // inside the 10s cooldown

      expect(forceReloadOnce()).toBe(false);
    });
  });

  describe("when the cooldown window has elapsed", () => {
    it("reloads again", () => {
      forceReloadOnce();
      vi.advanceTimersByTime(11_000); // past the 10s cooldown

      expect(forceReloadOnce()).toBe(true);
    });
  });
});

describe("reloadOnChunkError", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe("when the error is a chunk error", () => {
    it("reloads and reports it handled the error", () => {
      expect(reloadOnChunkError(new Error("Failed to fetch dynamically imported module"))).toBe(
        true,
      );
      expect(reloaded()).toBe(true);
    });
  });

  describe("when the error is not a chunk error", () => {
    it("does not reload and reports it did not handle the error", () => {
      expect(reloadOnChunkError(new Error("boom"))).toBe(false);
      expect(reloaded()).toBe(false);
    });
  });
});

describe("registerChunkReloadListener", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe("when Vite dispatches vite:preloadError for a stale chunk", () => {
    /** @scenario "A stale file outside a warm-up still reloads the page" */
    it("reloads the page once to fetch the new chunk hashes", () => {
      registerChunkReloadListener();

      const event = preloadErrorEvent(staleChunkError());
      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(reloaded()).toBe(true);
    });
  });

  describe("when a second vite:preloadError fires within the cooldown", () => {
    it("does not suppress the error so it can reach the error boundary", () => {
      // Simulate a reload already having happened in this session.
      sessionStorage.setItem(RELOAD_AT, "9999999999999");
      registerChunkReloadListener();

      const event = preloadErrorEvent(staleChunkError());
      window.dispatchEvent(event);

      // No reload scheduled → Vite's error must NOT be preventDefault()'d.
      expect(event.defaultPrevented).toBe(false);
    });
  });
});

describe("warmChunk", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe("when a warm-up asks for a file that is gone", () => {
    /** @scenario "A stale file during a warm-up does not reload the page" */
    it("does not reload the page", async () => {
      registerChunkReloadListener();

      const loaded = await warmChunk(() => {
        // Vite fires the event from its preload helper, then rejects the
        // import with the same error, so the warm-up is still in flight when
        // the listener runs.
        const failure = staleChunkError();
        window.dispatchEvent(preloadErrorEvent(failure));
        return Promise.reject(failure);
      });
      await settleDeferredReload();

      expect(loaded).toBe(false);
      expect(reloaded()).toBe(false);
    });
  });

  describe("given a warm-up is in flight", () => {
    describe("when another import fails because the file is gone", () => {
      /** @scenario "A stale file for a waiting screen reloads during a warm-up" */
      it("reloads the page for the import somebody is waiting for", async () => {
        registerChunkReloadListener();

        let finishWarmup = () => {};
        const warmup = warmChunk(
          () =>
            new Promise<void>((resolve) => {
              finishWarmup = resolve;
            }),
        );

        // A drawer the person just opened asks for a stale file. This error is
        // not the warm-up's, so recovery must still run.
        window.dispatchEvent(preloadErrorEvent(staleChunkError()));

        finishWarmup();
        await warmup;
        await settleDeferredReload();

        expect(reloaded()).toBe(true);
      });
    });
  });

  describe("when the warm-up has finished", () => {
    it("leaves a later stale chunk to reload the page", async () => {
      registerChunkReloadListener();
      await warmChunk(() => Promise.resolve());

      window.dispatchEvent(preloadErrorEvent(staleChunkError()));

      expect(reloaded()).toBe(true);
    });
  });
});
