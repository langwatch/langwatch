// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchNewerDeployEntry,
  handleChunkError,
  isChunkLoadError,
  registerChunkReloadListener,
  registerDeployWatcher,
  reloadForDeploy,
} from "./chunkReload";

// reloadForDeploy records the deployed entry it reloaded toward in
// sessionStorage. jsdom's window.location.reload() is a harmless no-op (and is
// non-spyable), so — like the rest of this module's recovery — we assert the
// observable sentinel it writes rather than the reload itself.
const RELOAD_TARGET = "chunk-reload-target";
const reloadTarget = () => sessionStorage.getItem(RELOAD_TARGET);

// Install a content-hashed entry <script> so loadedEntry() resolves, mimicking a
// built index.html. The dev server's entry is /src/main.tsx, which has no hash
// and disables version detection.
function setLoadedEntry(path: string | null) {
  document.head.innerHTML = path
    ? `<script type="module" src="${path}"></script>`
    : "";
}

// Stub the index.html the server serves, advertising the given entry path.
function mockServedEntry(path: string, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      text: async () => `<script type="module" src="${path}"></script>`,
    }),
  );
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
}

// Let a fetch().then() recovery chain settle (mock resolves immediately, so one
// macrotask drains every queued microtask).
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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
      expect(
        isChunkLoadError(new Error("error importing a module script failed")),
      ).toBe(true);
    });
  });

  describe("when the error is an ordinary runtime error", () => {
    it("does not classify it as a chunk-load error", () => {
      expect(
        isChunkLoadError(new Error("Cannot read properties of undefined")),
      ).toBe(false);
    });
  });

  describe("when given a non-Error value", () => {
    it("coerces to string and does not throw", () => {
      expect(isChunkLoadError(null)).toBe(false);
      expect(isChunkLoadError("Loading chunk 1 failed")).toBe(true);
    });
  });
});

describe("fetchNewerDeployEntry", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setLoadedEntry("/assets/index-OLD123.js");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setLoadedEntry(null);
  });

  describe("when the server serves a different entry", () => {
    it("returns the newer deployed entry", async () => {
      mockServedEntry("/assets/index-NEW456.js");
      await expect(fetchNewerDeployEntry()).resolves.toBe(
        "/assets/index-NEW456.js",
      );
    });
  });

  describe("when the server serves the same entry this tab booted with", () => {
    it("returns null", async () => {
      mockServedEntry("/assets/index-OLD123.js");
      await expect(fetchNewerDeployEntry()).resolves.toBeNull();
    });
  });

  describe("when there is no content-hashed entry (dev server)", () => {
    it("returns null without fetching", async () => {
      setLoadedEntry("/src/main.tsx");
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      await expect(fetchNewerDeployEntry()).resolves.toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the fetch fails", () => {
    it("returns null", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      await expect(fetchNewerDeployEntry()).resolves.toBeNull();
    });
  });
});

describe("reloadForDeploy", () => {
  beforeEach(() => sessionStorage.clear());

  describe("when reloading toward a newly deployed entry", () => {
    it("records the target and reports the reload", () => {
      expect(reloadForDeploy("/assets/index-NEW456.js")).toBe(true);
      expect(reloadTarget()).toBe("/assets/index-NEW456.js");
    });
  });

  describe("when the same target was already reloaded toward", () => {
    it("does not reload again (no loop on a build that won't land)", () => {
      reloadForDeploy("/assets/index-NEW456.js");
      expect(reloadForDeploy("/assets/index-NEW456.js")).toBe(false);
    });
  });

  describe("when a different deploy ships next", () => {
    it("reloads again", () => {
      reloadForDeploy("/assets/index-NEW456.js");
      expect(reloadForDeploy("/assets/index-NEWER789.js")).toBe(true);
    });
  });
});

describe("handleChunkError", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setLoadedEntry("/assets/index-OLD123.js");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setLoadedEntry(null);
  });

  describe("when the error is not a chunk error", () => {
    it("returns false and does not check for a deploy", () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      expect(handleChunkError(new Error("boom"))).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("when a chunk error coincides with a newer deploy", () => {
    it("reloads for the newer deploy", async () => {
      mockServedEntry("/assets/index-NEW456.js");

      expect(
        handleChunkError(
          new Error("Failed to fetch dynamically imported module"),
        ),
      ).toBe(true);
      await settle();

      expect(reloadTarget()).toBe("/assets/index-NEW456.js");
    });
  });

  describe("when a chunk error has no newer deploy (persistent failure)", () => {
    it("does not reload, leaving the boundary to surface", async () => {
      mockServedEntry("/assets/index-OLD123.js");

      handleChunkError(
        new Error("Failed to fetch dynamically imported module"),
      );
      await settle();

      expect(reloadTarget()).toBeNull();
    });
  });
});

describe("registerDeployWatcher", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setLoadedEntry("/assets/index-OLD123.js");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setLoadedEntry(null);
  });

  describe("when the tab becomes visible and a newer deploy is live", () => {
    it("reloads for the newer deploy", async () => {
      mockServedEntry("/assets/index-NEW456.js");
      registerDeployWatcher();

      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await settle();

      expect(reloadTarget()).toBe("/assets/index-NEW456.js");
    });
  });

  describe("when the tab is hidden", () => {
    it("does not check for a deploy", () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      registerDeployWatcher();

      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

describe("registerChunkReloadListener", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setLoadedEntry("/assets/index-OLD123.js");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setLoadedEntry(null);
  });

  describe("when Vite fires vite:preloadError and a newer deploy is live", () => {
    it("reloads for the newer deploy", async () => {
      mockServedEntry("/assets/index-NEW456.js");
      registerChunkReloadListener();

      window.dispatchEvent(new Event("vite:preloadError"));
      await settle();

      expect(reloadTarget()).toBe("/assets/index-NEW456.js");
    });
  });
});
