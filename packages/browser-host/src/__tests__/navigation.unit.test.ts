// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forceReloadOnce,
  isChunkLoadError,
  isServerUnreachable,
  isUiApiUnreachable,
  isUiNavigatingAway,
  nextUiApiPollDelay,
  RELOAD_IDLE_KEY,
  registerChunkReloadListener,
  reloadOnBundleSwap,
  uiLeaveTo,
  uiOpenExternal,
} from "../navigation.ts";
import { setUiStorage, UiStorage } from "../storage.ts";

// jsdom locks down window.location (non-configurable, can't be deleted, redefined
// or spied), and location.reload() is a harmless no-op there. So rather than
// asserting reload() was called, we assert the observable cooldown sentinel it
// writes to sessionStorage — which is where the branching logic actually lives.
const RELOAD_AT = "chunk-reload-at";
const reloaded = () => sessionStorage.getItem(RELOAD_AT) !== null;

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

describe("given a failure that never reached the server", () => {
  describe("when the browser says the fetch did not complete", () => {
    it("recognises each engine's way of saying it", () => {
      for (const message of [
        "Failed to fetch",
        "NetworkError when attempting to fetch resource.",
        "Load failed",
        "fetch failed",
      ]) {
        expect(isServerUnreachable(new Error(message))).toBe(true);
      }
    });

    it("recognises it on a plain tRPC-shaped object too", () => {
      expect(isServerUnreachable({ message: "Failed to fetch" })).toBe(true);
    });
  });
});

describe("given a failure the server answered with", () => {
  describe("when it carries an HTTP status", () => {
    it("is reachable, whatever the message happens to say", () => {
      // The message alone would match. The status is what settles it: a
      // server that refused is a server that is up, and calling that a
      // network blip hides a fault we could have named.
      expect(
        isServerUnreachable({
          message: "Failed to fetch",
          data: { httpStatus: 500 },
        }),
      ).toBe(false);
    });
  });

  describe("when it carries an error code", () => {
    it("is reachable", () => {
      expect(
        isServerUnreachable({
          message: "load failed",
          data: { code: "INTERNAL_SERVER_ERROR" },
        }),
      ).toBe(false);
    });
  });

  describe("when it is an ordinary refusal", () => {
    it("is left to the registry", () => {
      expect(
        isServerUnreachable({
          message: "validation_error",
          data: { httpStatus: 400, code: "BAD_REQUEST" },
        }),
      ).toBe(false);
    });
  });
});

describe("given no failure at all", () => {
  it("answers false rather than guessing", () => {
    expect(isServerUnreachable(null)).toBe(false);
    expect(isServerUnreachable(undefined)).toBe(false);
    expect(isServerUnreachable({})).toBe(false);
  });
});

/**
 * The proxy in front of a rolling deploy, captured from haven: an api lane
 * down answers 502 with an EMPTY body, so there's no envelope and the
 * message is whatever the JSON parser said.
 */
describe("given an intermediary answering while the app is still coming up", () => {
  it.each([[502], [503], [504]])("treats a bodiless %i as nothing having answered", (status) => {
    expect(
      isServerUnreachable({
        message: "Unexpected end of JSON input",
        meta: { response: { status } },
      }),
    ).toBe(true);
  });

  describe("when the same status carries one of our own codes", () => {
    it.each([
      ["gateway_unavailable", 502],
      ["circuit_open", 503],
      ["code_block_timeout", 504],
    ])("leaves %s to the registry, which says it better", (code, status) => {
      // The status alone cannot decide this. These are real, named upstream
      // failures with remediation of their own, and calling them a network
      // blip would tell the reader to wait for something that will not
      // change on its own.
      expect(
        isServerUnreachable({
          message: code,
          data: { httpStatus: status, code },
          meta: { response: { status } },
        }),
      ).toBe(false);
    });
  });

  describe("when the raw status is not one an intermediary sends", () => {
    it("stays a fault", () => {
      expect(
        isServerUnreachable({
          message: "Unexpected end of JSON input",
          meta: { response: { status: 500 } },
        }),
      ).toBe(false);
    });
  });
});

describe("isUiApiUnreachable", () => {
  describe("given no answer at all", () => {
    it("is unreachable", () => {
      expect(isUiApiUnreachable({})).toBe(true);
    });
  });

  describe("given a bare gateway status with no code", () => {
    it("is unreachable", () => {
      expect(isUiApiUnreachable({ status: 502 })).toBe(true);
    });
  });

  describe("given the same status with one of our own codes", () => {
    it("is reachable — something answered, named", () => {
      expect(isUiApiUnreachable({ status: 502, code: "circuit_open" })).toBe(false);
    });
  });

  describe("given an ordinary client error", () => {
    it("is reachable", () => {
      expect(isUiApiUnreachable({ status: 404 })).toBe(false);
    });
  });
});

describe("nextUiApiPollDelay", () => {
  it("eases off geometrically up to the ceiling", () => {
    expect(nextUiApiPollDelay(500)).toBe(750);
    expect(nextUiApiPollDelay(3_000)).toBe(3_000);
  });
});

describe("given a full-page departure", () => {
  describe("when nothing has asked the tab to leave yet", () => {
    it("reports it is not navigating away", () => {
      expect(isUiNavigatingAway()).toBe(false);
    });
  });

  describe("when opening an address this application does not serve", () => {
    it("opens a new tab without an opener, and does not mark the tab as leaving", () => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);

      uiOpenExternal("https://github.com/langwatch/langwatch");

      expect(open).toHaveBeenCalledWith(
        "https://github.com/langwatch/langwatch",
        "_blank",
        "noopener,noreferrer",
      );
      expect(isUiNavigatingAway()).toBe(false);
      open.mockRestore();
    });
  });

  describe("when replacing this document with another address", () => {
    it("marks the tab as leaving, so an aborted request in flight is not read as a fault", () => {
      uiLeaveTo("/auth/signin");

      expect(isUiNavigatingAway()).toBe(true);
    });
  });
});

/** A storage port holding only the idle-reload knob. */
class IdleKnob extends UiStorage {
  constructor(private readonly ms: number) {
    super();
  }
  read(key: string): string | undefined {
    return key === RELOAD_IDLE_KEY ? String(this.ms) : void 0;
  }
  write(): void {}
  remove(): void {}
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const WATCH_META = '<meta name="haven-ui-watch" content="1">';

/** A chunk a rebuild removed: Vite reports it, and the server answers that it is gone. */
function reportRemovedChunk(): Event {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
  const event = Object.assign(new Event("vite:preloadError", { cancelable: true }), {
    payload: new Error("Failed to fetch dynamically imported module: /assets/page-old.js"),
  });
  window.dispatchEvent(event);
  return event;
}

describe("reloading only when the reader is idle", () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
  });

  afterEach(() => {
    setUiStorage(undefined);
    vi.unstubAllGlobals();
    document.head.innerHTML = "";
  });

  describe("given a watch-mode page whose reader pressed a key just now", () => {
    describe("when a stale chunk fails to preload", () => {
      /** @scenario "An open watch-mode page reloads after a swap only once idle" */
      it("waits until they stop before reloading", async () => {
        setUiStorage(new IdleKnob(80));
        document.head.innerHTML = WATCH_META;
        registerChunkReloadListener();
        window.dispatchEvent(new KeyboardEvent("keydown"));

        const event = reportRemovedChunk();
        expect(event.defaultPrevented).toBe(false);
        // Long enough for the server to answer that the chunk is gone.
        await wait(20);
        expect(reloaded()).toBe(false);

        await wait(150);
        expect(reloaded()).toBe(true);
      });
    });
  });

  describe("given a page that is not a watch-mode page", () => {
    /** @scenario "An open watch-mode page reloads after a swap only once idle" */
    it("reloads at once on a stale route chunk, whoever is typing", async () => {
      setUiStorage(new IdleKnob(60_000));
      registerChunkReloadListener();
      window.dispatchEvent(new KeyboardEvent("keydown"));

      reportRemovedChunk();

      await wait(20);
      expect(reloaded()).toBe(true);
    });

    /** @scenario "An open watch-mode page reloads after a swap only once idle" */
    it("never polls for a new bundle", async () => {
      document.head.innerHTML = '<script type="module" src="/assets/index-old.js"></script>';
      const fetchSpy = vi.fn(async () => new Response(""));
      vi.stubGlobal("fetch", fetchSpy);
      reloadOnBundleSwap({ pollMs: 10 });

      await wait(40);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("given a watch-mode page whose served index names a new entry chunk", () => {
    /** @scenario "An open watch-mode page reloads after a swap only once idle" */
    it("reloads once the reader is idle", async () => {
      setUiStorage(new IdleKnob(1));
      document.head.innerHTML = `${WATCH_META}<script type="module" src="/assets/index-old.js"></script>`;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response('<script type="module" crossorigin src="/assets/index-new.js"></script>'),
        ),
      );
      reloadOnBundleSwap({ pollMs: 10 });

      await wait(60);
      expect(reloaded()).toBe(true);
    });
  });

  describe("given the served index still names the watch-mode page's own entry chunk", () => {
    it("does not reload", async () => {
      setUiStorage(new IdleKnob(1));
      document.head.innerHTML = `${WATCH_META}<script type="module" src="/assets/index-old.js"></script>`;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () => new Response('<script type="module" src="/assets/index-old.js"></script>'),
        ),
      );
      reloadOnBundleSwap({ pollMs: 10 });

      await wait(60);
      expect(reloaded()).toBe(false);
    });
  });
});
