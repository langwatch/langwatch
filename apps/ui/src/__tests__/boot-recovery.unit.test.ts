/**
 * Runs the real `ui-boot-recovery` script from index.html against stand-ins for the browser
 * globals it reads, so a test can see a reload jsdom would not perform.
 * Spec: specs/ui/boot-recovery.feature
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { UI_BOOT_EVENTS } from "@langwatch/browser-host/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const INDEX_HTML = readFileSync(path.resolve(import.meta.dirname, "../../index.html"), "utf8");
const SCRIPT = /<script id="ui-boot-recovery">([\s\S]*?)<\/script>/.exec(INDEX_HTML)?.[1] ?? "";
const KEY = "ui-boot-attempt";

type Resource = { name: string; transferSize: number };

/** One page load: the script runs with its own window events, storage and timing. */
function bootPage({
  saved = null,
  resources = [],
  storage = "works",
}: {
  saved?: string | null;
  resources?: Resource[];
  storage?: "works" | "refused";
} = {}) {
  const win = new EventTarget();
  const location = { reload: vi.fn() };
  const store = new Map<string, string>(saved === null ? [] : [[KEY, saved]]);
  const sessionStorage = {
    getItem: (key: string) => {
      if (storage === "refused") throw new DOMException("denied", "SecurityError");
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (storage === "refused") throw new DOMException("denied", "SecurityError");
      store.set(key, value);
    },
    removeItem: (key: string) => store.delete(key),
  };
  const performance = { getEntriesByType: () => resources };
  let resourceFinished = () => {};
  class PerformanceObserver {
    constructor(callback: () => void) {
      resourceFinished = callback;
    }
    observe() {}
  }

  runInNewContext(SCRIPT, {
    location,
    sessionStorage,
    performance,
    PerformanceObserver,
    addEventListener: win.addEventListener.bind(win),
    removeEventListener: win.removeEventListener.bind(win),
    document,
    // The test's clock, so fake timers drive the stall check.
    Date,
    setInterval,
    clearInterval,
  });

  /** A resource event at `el`, as the browser delivers it to a capturing window listener. */
  const fail = (el: Element) => {
    const event = new Event("error");
    Object.defineProperty(event, "target", { value: el });
    win.dispatchEvent(event);
  };
  const chunkFailed = () => {
    const event = new Event(UI_BOOT_EVENTS.chunkFailed, { cancelable: true });
    win.dispatchEvent(event);
    return event.defaultPrevented;
  };

  return {
    location,
    saved: () => store.get(KEY) ?? null,
    fail,
    chunkFailed,
    mounted: () => win.dispatchEvent(new Event(UI_BOOT_EVENTS.mounted)),
    resourceFinished: () => resourceFinished(),
  };
}

const status = () => document.querySelector("[role=status]");
const statusText = () => status()?.textContent ?? "";

/** The server's page is parsed: what is in the document now is what it sent. */
function finishParsing() {
  Object.defineProperty(document, "readyState", { configurable: true, value: "interactive" });
  document.dispatchEvent(new Event("readystatechange"));
}

function addTag(html: string): Element {
  document.head.insertAdjacentHTML("beforeend", html);
  return document.head.lastElementChild as Element;
}

const CODE_FETCHED: Resource[] = [
  { name: "https://app.example/assets/core-x.js", transferSize: 9 },
];
const ONLY_API_FETCHED: Resource[] = [{ name: "https://app.example/api/session", transferSize: 9 }];

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "readyState", { configurable: true, value: "loading" });
});

afterEach(() => {
  vi.useRealTimers();
  document.head.innerHTML = "";
  status()?.remove();
});

describe("given the page has not shown yet", () => {
  describe("when a script the server's page names fails", () => {
    /** @scenario "A dropped entry file reloads the page" */
    it("reloads and says it is retrying", () => {
      const page = bootPage();
      const entry = addTag('<script type="module" src="/assets/core-x.js"></script>');
      finishParsing();

      page.fail(entry);

      expect(page.location.reload).toHaveBeenCalledTimes(1);
      expect(statusText()).toBe("Slow connection, retrying (1 of 6)...");
    });
  });

  describe("when a stylesheet the server's page names fails before parsing ends", () => {
    it("reloads", () => {
      const page = bootPage();

      page.fail(addTag('<link rel="stylesheet" href="/assets/core-x.css">'));

      expect(page.location.reload).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a stylesheet the application added itself fails", () => {
    /** @scenario "A file a screen adds later does not reload the page" */
    it("leaves it to the application", () => {
      const page = bootPage();
      finishParsing();

      page.fail(addTag('<link rel="stylesheet" href="/assets/screen-x.css">'));

      expect(page.location.reload).not.toHaveBeenCalled();
    });
  });

  describe("when a chunk fails after its retries", () => {
    /** @scenario "A chunk that outlived its retries before the first page reloads the page" */
    it("takes the failure and reloads", () => {
      const page = bootPage();

      expect(page.chunkFailed()).toBe(true);
      expect(page.location.reload).toHaveBeenCalledTimes(1);
    });
  });

  describe("when nothing finishes loading for 30 seconds", () => {
    /** @scenario "A request that hangs counts as dropped" */
    it("reloads, and not while files keep arriving", () => {
      const page = bootPage();

      vi.advanceTimersByTime(20_000);
      page.resourceFinished();
      vi.advanceTimersByTime(20_000);
      expect(page.location.reload).not.toHaveBeenCalled();

      vi.advanceTimersByTime(11_000);
      expect(page.location.reload).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given earlier reloads", () => {
  describe("when the last load fetched new code and still failed", () => {
    /** @scenario "A reload that fetched new code is progress" */
    it("starts the count of tries without progress again", () => {
      const page = bootPage({ saved: "4,7", resources: CODE_FETCHED });

      page.chunkFailed();

      expect(page.saved()).toBe("0,8");
      expect(page.location.reload).toHaveBeenCalledTimes(1);
    });
  });

  describe("when only API answers arrived", () => {
    it("is not progress", () => {
      const page = bootPage({ saved: "2,2", resources: ONLY_API_FETCHED });

      page.chunkFailed();

      expect(page.saved()).toBe("3,3");
      expect(statusText()).toBe("Slow connection, retrying (3 of 6)...");
    });
  });

  describe("when six reloads in a row fetched nothing new", () => {
    /** @scenario "Six reloads in a row that fetch nothing new give up" */
    it("asks the person to try again, and stops reloading", () => {
      const page = bootPage({ saved: "6,6" });

      page.chunkFailed();

      expect(page.location.reload).not.toHaveBeenCalled();
      expect(statusText()).toContain("Could not load. Check your connection.");
      expect(status()?.querySelector("button")?.textContent).toBe("Try again");
      expect(page.saved()).toBeNull();
    });
  });

  describe("when the page loads after a retry", () => {
    it("says which retry it is on", () => {
      bootPage({ saved: "2,3" });

      expect(statusText()).toBe("Slow connection, retrying (2 of 6)...");
    });
  });
});

describe("given the browser refuses session storage", () => {
  /** @scenario "Without storage for the counter the page asks instead of reloading" */
  it("offers Try again instead of reloading", () => {
    const page = bootPage({ storage: "refused" });

    page.chunkFailed();

    expect(page.location.reload).not.toHaveBeenCalled();
    expect(status()?.querySelector("button")).not.toBeNull();
  });
});

describe("given the page reloaded twice to boot", () => {
  describe("when the first page shows", () => {
    /** @scenario "The first page clears the counter" */
    it("clears the counter, removes the status line and stands down", () => {
      const page = bootPage({ saved: "1,2" });

      page.mounted();

      expect(page.saved()).toBeNull();
      expect(status()).toBeNull();
      expect(page.chunkFailed()).toBe(false);
      vi.advanceTimersByTime(60_000);
      expect(page.location.reload).not.toHaveBeenCalled();
    });
  });
});
