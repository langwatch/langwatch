/**
 * @vitest-environment jsdom
 * Spec: specs/navigation/chunk-load-retry.feature, specs/navigation/drawer-chunk-warmup.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refetch = vi.hoisted(() => ({ importChunkAgain: vi.fn() }));
vi.mock("../chunk-refetch.ts", () => refetch);

import {
  CHUNK_RETRY_DELAYS_MS,
  chunkUrlOf,
  importChunk,
  isChunkLoadFailure,
  lazyRoute,
  loadChunk,
  registerChunkReloadListener,
  signalUiMounted,
  UI_BOOT_EVENTS,
  warmChunk,
} from "../navigation.ts";

const CHUNK = "https://app.langwatch.ai/assets/authz-host-mount-Bx1.js";
const dropped = (url = CHUNK) =>
  new TypeError(`Failed to fetch dynamically imported module: ${url}`);
// Safari names no address.
const droppedInSafari = () => new TypeError("Importing a module script failed.");
const MODULE = { default: "the module" };

const RELOAD_AT = "chunk-reload-at";
const reloaded = () => sessionStorage.getItem(RELOAD_AT) !== null;

/** Records each wait instead of sleeping. */
function recordedWaits() {
  const waits: number[] = [];
  return {
    waits,
    wait: async (ms: number) => {
      waits.push(ms);
    },
  };
}

const serverAnswers = (status: number) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status })),
  );

const serverUnreachable = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );

/** Let a deferred listener decision and its probe run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  sessionStorage.clear();
  refetch.importChunkAgain.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("loadChunk and importChunk", () => {
  describe("given a chunk that loads", () => {
    it("returns it without waiting", async () => {
      const { waits, wait } = recordedWaits();

      await expect(loadChunk(() => Promise.resolve(MODULE), { wait })).resolves.toBe(MODULE);
      expect(waits).toEqual([]);
    });
  });

  describe("given a request dropped twice, then answered", () => {
    /** @scenario "A dropped chunk request is retried with backoff" */
    it("waits half a second, then a second, and loads it", async () => {
      const { waits, wait } = recordedWaits();
      refetch.importChunkAgain
        .mockRejectedValueOnce(dropped(`${CHUNK}?retry=1`))
        .mockResolvedValueOnce(MODULE);

      await expect(importChunk(() => Promise.reject(dropped()), { wait })).resolves.toBe(MODULE);
      expect(waits).toEqual([500, 1_000]);
    });

    /** @scenario "A retry asks for the chunk under a fresh address" */
    it("asks for the address the failure named, under a fresh query each time", async () => {
      const { wait } = recordedWaits();
      refetch.importChunkAgain
        .mockRejectedValueOnce(dropped(`${CHUNK}?retry=1`))
        .mockResolvedValueOnce(MODULE);

      await importChunk(() => Promise.reject(dropped()), { wait });

      expect(refetch.importChunkAgain.mock.calls).toEqual([
        [{ url: CHUNK, attempt: 1 }],
        [{ url: CHUNK, attempt: 2 }],
      ]);
    });
  });

  describe("given a loader that reshapes what it imports", () => {
    /** @scenario "A loader that reshapes its module keeps its shape on a retry" */
    it("retries through the loader, never by the address", async () => {
      const { wait } = recordedWaits();
      refetch.importChunkAgain.mockResolvedValue({ Thing: "the raw module" });
      const load = vi
        .fn<() => Promise<typeof MODULE>>()
        .mockRejectedValueOnce(dropped())
        .mockResolvedValueOnce(MODULE);

      await expect(loadChunk(load, { wait })).resolves.toBe(MODULE);
      expect(refetch.importChunkAgain).not.toHaveBeenCalled();
    });

    it("does not retry again what the import inside it gave up on", async () => {
      const { waits, wait } = recordedWaits();
      serverUnreachable();
      refetch.importChunkAgain.mockRejectedValue(dropped());

      const loading = loadChunk(
        async () => ({ default: await importChunk(() => Promise.reject(dropped()), { wait }) }),
        { wait },
      );

      await expect(loading).rejects.toBeTruthy();
      expect(waits).toEqual([...CHUNK_RETRY_DELAYS_MS]);
    });
  });

  describe("given an engine that names no address", () => {
    it("retries through the loader itself", async () => {
      const { wait } = recordedWaits();
      const load = vi
        .fn<() => Promise<typeof MODULE>>()
        .mockRejectedValueOnce(droppedInSafari())
        .mockResolvedValueOnce(MODULE);

      await expect(importChunk(load, { wait })).resolves.toBe(MODULE);
      expect(load).toHaveBeenCalledTimes(2);
      expect(refetch.importChunkAgain).not.toHaveBeenCalled();
    });
  });

  describe("given a module that loaded and threw while running", () => {
    it("rejects at once, since a retry cannot fix it", async () => {
      const { waits, wait } = recordedWaits();
      const failure = new Error("the screen threw");

      await expect(loadChunk(() => Promise.reject(failure), { wait })).rejects.toBe(failure);
      expect(waits).toEqual([]);
    });
  });

  describe("given a chunk that never arrives", () => {
    /** @scenario "A chunk that never arrives fails after three retries" */
    it("tries four times in all, then rejects with the failure", async () => {
      const { waits, wait } = recordedWaits();
      serverUnreachable();
      const last = dropped(`${CHUNK}?retry=3`);
      refetch.importChunkAgain
        .mockRejectedValueOnce(dropped(`${CHUNK}?retry=1`))
        .mockRejectedValueOnce(dropped(`${CHUNK}?retry=2`))
        .mockRejectedValueOnce(last);

      await expect(importChunk(() => Promise.reject(dropped()), { wait })).rejects.toBe(last);
      expect(waits).toEqual([...CHUNK_RETRY_DELAYS_MS]);
    });

    /** @scenario "A dropped connection never reloads the page" */
    it("does not reload when the server does not answer", async () => {
      const { wait } = recordedWaits();
      serverUnreachable();
      refetch.importChunkAgain.mockRejectedValue(dropped());

      await expect(loadChunk(() => Promise.reject(dropped()), { wait })).rejects.toBeTruthy();
      expect(reloaded()).toBe(false);
    });

    /** @scenario "A chunk a deploy removed reloads the page once" */
    it("reloads once when the server says the chunk is gone", async () => {
      const { wait } = recordedWaits();
      serverAnswers(404);
      refetch.importChunkAgain.mockRejectedValue(dropped());

      await expect(loadChunk(() => Promise.reject(dropped()), { wait })).rejects.toBeTruthy();
      expect(reloaded()).toBe(true);
    });
  });

  describe("given the first page has not shown yet", () => {
    /** @scenario "A chunk that outlived its retries before the first page reloads the page" */
    it("hands the failure to the boot recovery, and probes nothing itself", async () => {
      const { wait } = recordedWaits();
      const fetchSpy = vi.fn(async () => new Response(null, { status: 404 }));
      vi.stubGlobal("fetch", fetchSpy);
      refetch.importChunkAgain.mockRejectedValue(dropped());
      const takeIt = (event: Event) => event.preventDefault();
      window.addEventListener(UI_BOOT_EVENTS.chunkFailed, takeIt);

      try {
        await expect(loadChunk(() => Promise.reject(dropped()), { wait })).rejects.toBeTruthy();
      } finally {
        window.removeEventListener(UI_BOOT_EVENTS.chunkFailed, takeIt);
      }

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(reloaded()).toBe(false);
    });
  });
});

describe("signalUiMounted", () => {
  it("tells the boot recovery the first page showed", () => {
    const heard = vi.fn();
    window.addEventListener(UI_BOOT_EVENTS.mounted, heard);

    signalUiMounted();

    window.removeEventListener(UI_BOOT_EVENTS.mounted, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("lazyRoute", () => {
  describe("given a route chunk dropped once", () => {
    it("retries it and hands React Router the component", async () => {
      vi.useFakeTimers();
      const load = vi
        .fn<() => Promise<{ default: typeof Page }>>()
        .mockRejectedValueOnce(dropped())
        .mockResolvedValueOnce({ default: Page });
      const route = lazyRoute(load);

      const loading = route.lazy();
      await vi.runAllTimersAsync();

      await expect(loading).resolves.toEqual({ Component: Page });
    });
  });
});

describe("registerChunkReloadListener", () => {
  const preloadError = (payload: Error) =>
    Object.assign(new Event("vite:preloadError", { cancelable: true }), { payload });

  /** @scenario "Vite's preload error never turns a failure into an empty module" */
  it("never prevents Vite from rejecting the import", () => {
    registerChunkReloadListener();
    const event = preloadError(dropped());

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  describe("given a failure a loader owns", () => {
    it("leaves the recovery to that loader", async () => {
      registerChunkReloadListener();
      const fetchSpy = vi.fn(async () => new Response(null, { status: 404 }));
      vi.stubGlobal("fetch", fetchSpy);
      refetch.importChunkAgain.mockResolvedValueOnce(MODULE);
      const failure = dropped();

      const loading = importChunk(
        () => {
          // Vite reports the failure, then rejects the import with it.
          window.dispatchEvent(preloadError(failure));
          return Promise.reject(failure);
        },
        { wait: () => Promise.resolve() },
      );

      await expect(loading).resolves.toBe(MODULE);
      await settle();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(reloaded()).toBe(false);
    });
  });

  describe("given a warm-up whose download failed", () => {
    /** @scenario "A stale file during a warm-up does not reload the page" */
    it("does not reload the page", async () => {
      registerChunkReloadListener();
      serverAnswers(404);

      const loaded = await warmChunk(() => {
        const failure = dropped();
        window.dispatchEvent(preloadError(failure));
        return Promise.reject(failure);
      });
      await settle();

      expect(loaded).toBe(false);
      expect(reloaded()).toBe(false);
    });
  });

  describe("given a bare import no loader owns", () => {
    /** @scenario "A stale file outside a warm-up still reloads the page" */
    it("reloads once when the server says the chunk is gone", async () => {
      registerChunkReloadListener();
      serverAnswers(404);

      window.dispatchEvent(preloadError(dropped()));
      await settle();
      await settle();

      expect(reloaded()).toBe(true);
    });

    it("does not reload when the server does not answer", async () => {
      registerChunkReloadListener();
      serverUnreachable();

      window.dispatchEvent(preloadError(dropped()));
      await settle();
      await settle();

      expect(reloaded()).toBe(false);
    });
  });
});

describe("isChunkLoadFailure", () => {
  it("finds a chunk failure wrapped as a cause", () => {
    const wrapped = new Error("Module authz mounts AuthzHostApi, and its module did not load.", {
      cause: dropped(),
    });

    expect(isChunkLoadFailure(wrapped)).toBe(true);
    expect(isChunkLoadFailure(new Error("boom"))).toBe(false);
  });
});

describe("chunkUrlOf", () => {
  it("reads the address Chrome and Firefox name, without its query", () => {
    expect(chunkUrlOf(dropped(`${CHUNK}?retry=2`))).toBe(CHUNK);
    expect(chunkUrlOf(new TypeError(`error loading dynamically imported module: ${CHUNK}`))).toBe(
      CHUNK,
    );
    expect(chunkUrlOf(droppedInSafari())).toBeUndefined();
  });
});

function Page() {
  return null;
}
