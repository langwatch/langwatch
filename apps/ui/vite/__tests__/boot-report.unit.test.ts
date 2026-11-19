/**
 * Runs the real boot report script against stand-ins for the browser globals it reads, so a
 * test can drive the clock, the page's visibility and what the browser can send.
 * Spec: specs/ui/boot-report.feature
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { createPublicAppConfigMetaTag } from "@langwatch/config/public-app-config";
import {
  RUM_SESSION_HEADER,
  RUM_SESSION_ID_KEY,
  RUM_SESSION_LAST_SEEN_KEY,
  RUM_TRACES_PATH,
} from "@langwatch/react-rum/constants";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ATTR_BOOT_OUTCOME,
  BOOT_REPORT_EVENTS,
  BOOT_REPORT_SCRIPT,
  BOOT_SPAN_NAME,
  BOOT_STALL_MS,
} from "../boot-report";

const SAMPLED_SESSION = "00000000aaaaaaaaaaaaaaaaaaaaaaaa";
const UNSAMPLED_SESSION = "ffffffffaaaaaaaaaaaaaaaaaaaaaaaa";

type Span = {
  traceId: string;
  name: string;
  attributes: { key: string; value: Record<string, unknown> }[];
};

/** One page load: the script runs with its own window, storage, clock and senders. */
function bootPage({
  tracing = true,
  session = SAMPLED_SESSION,
  beacon = "works",
  fetchAvailable = true,
  pathname = "/my-project/messages",
  search = "",
  servedRelease = "git-6391517b",
  attempts = null,
}: {
  tracing?: boolean;
  session?: string;
  beacon?: "works" | "missing";
  fetchAvailable?: boolean;
  pathname?: string;
  search?: string;
  servedRelease?: string;
  attempts?: string | null;
} = {}) {
  document.head.innerHTML = [
    createPublicAppConfigMetaTag({
      process: { mode: "production" },
      rum: { enabled: tracing, sampleRatio: 0.1 },
    }),
  ].join("");
  document.body.innerHTML =
    '<div id="root"></div><script type="module" src="https://cdn.test/git-11111111/assets/index-a1.js"></script>' +
    '<link rel="modulepreload" href="https://cdn.test/git-11111111/assets/chunk-b2.js">';

  const win = new EventTarget();
  const store = new Map<string, string>([
    [RUM_SESSION_ID_KEY, session],
    [RUM_SESSION_LAST_SEEN_KEY, String(Date.now())],
  ]);
  if (attempts !== null) store.set("ui-boot-attempt", attempts);
  const sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  };
  const beacons: string[] = [];
  const posts: { body: string; init: RequestInit }[] = [];
  const fetchStub = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === RUM_TRACES_PATH) {
      posts.push({ body: typeof init.body === "string" ? init.body : "", init });
      return new Response(null, { status: 202 });
    }
    if (servedRelease === "hang") return new Promise<Response>(() => undefined);
    return new Response(
      `<html><head><script type="module" crossorigin src="https://cdn.test/${servedRelease}/assets/index-b2.js"></script></head></html>`,
    );
  });
  const startedAt = Date.now();
  const resources = [
    { name: "https://cdn.test/git-11111111/assets/index-a1.js", duration: 1200 },
    { name: "https://app.test/api/health", duration: 4000 },
  ];

  runInNewContext(BOOT_REPORT_SCRIPT, {
    document,
    location: { pathname, search },
    sessionStorage,
    addEventListener: win.addEventListener.bind(win),
    navigator:
      beacon === "works"
        ? {
            sendBeacon: (_url: string, blob: FakeBlob) => {
              beacons.push(blob.text);
              return true;
            },
          }
        : {},
    fetch: fetchAvailable ? fetchStub : undefined,
    Blob: FakeBlob,
    performance: {
      now: () => Date.now() - startedAt,
      timeOrigin: startedAt,
      getEntriesByType: (type: string) => (type === "resource" ? resources : []),
    },
    crypto: globalThis.crypto,
    atob: globalThis.atob,
    TextDecoder: globalThis.TextDecoder,
    setTimeout,
    Date,
  });

  const spans = (): Span[] =>
    [...beacons, ...posts.map((post) => post.body)].map(
      (body) => JSON.parse(body).resourceSpans[0].scopeSpans[0].spans[0] as Span,
    );

  return {
    spans,
    posts,
    store,
    fail: (element: Element) => {
      const event = new Event("error");
      Object.defineProperty(event, "target", { value: element });
      win.dispatchEvent(event);
    },
    unload: () => win.dispatchEvent(new Event("pagehide")),
    mounted: () => win.dispatchEvent(new Event("ui:mounted")),
    hide: () => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    },
    entryRan: () => document.dispatchEvent(new Event(BOOT_REPORT_EVENTS.entry)),
    healthAnswered: () =>
      document.dispatchEvent(
        new CustomEvent(BOOT_REPORT_EVENTS.health, { detail: { state: "ok", ms: 60 } }),
      ),
    drawn: () => document.dispatchEvent(new Event(BOOT_REPORT_EVENTS.done)),
    showLoadingScreen: (reason: string) => {
      document.getElementById("root")!.innerHTML =
        `<div data-testid="loading-screen" data-loading-reason="${reason}"></div>`;
    },
  };
}

class FakeBlob {
  readonly text: string;
  constructor(parts: string[]) {
    this.text = parts.join("");
  }
}

function attributeOf(span: Span | undefined, key: string): unknown {
  const value = span?.attributes.find((attribute) => attribute.key === key)?.value;
  if (!value) return undefined;
  if ("intValue" in value) return Number(value.intValue);
  return value.stringValue ?? value.boolValue;
}

/** The stall timer fires, then the fetch of a fresh page answers. */
async function passStallThreshold() {
  await vi.advanceTimersByTimeAsync(BOOT_STALL_MS);
  await vi.advanceTimersByTimeAsync(0);
}

describe("the boot report", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, "visibilityState");
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("hears the entry module by the event the entry sends", () => {
    const entry = readFileSync(path.resolve(import.meta.dirname, "../../src/main.tsx"), "utf8");
    expect(entry).toContain(`new Event("${BOOT_REPORT_EVENTS.entry}")`);
  });

  describe("given a sampled session", () => {
    /** @scenario "A page drawn in time is reported for a sampled session" */
    it("sends a drawn boot span with the time to the first page", async () => {
      const page = bootPage();
      await vi.advanceTimersByTimeAsync(1200);
      page.mounted();
      await vi.advanceTimersByTimeAsync(300);
      page.drawn();

      const [span] = page.spans();
      expect(span?.name).toBe(BOOT_SPAN_NAME);
      expect(attributeOf(span, ATTR_BOOT_OUTCOME)).toBe("drawn");
      expect(attributeOf(span, "langwatch.boot.drawn_ms")).toBe(1500);
      expect(attributeOf(span, "langwatch.boot.mounted_ms")).toBe(1200);
      expect(attributeOf(span, "session.id")).toBe(SAMPLED_SESSION);
      await passStallThreshold();
      expect(page.spans()).toHaveLength(1);
    });
  });

  describe("given an unsampled session", () => {
    /** @scenario "A page drawn in time is not reported for an unsampled session" */
    it("sends nothing for a boot that draws in time", async () => {
      const page = bootPage({ session: UNSAMPLED_SESSION });
      await vi.advanceTimersByTimeAsync(1500);
      page.drawn();
      await passStallThreshold();
      expect(page.spans()).toEqual([]);
    });

    /** @scenario "A boot still on the loading screen after 8 seconds is reported as stalled" */
    it("reports a stall with what the boot was waiting on", async () => {
      const page = bootPage({ session: UNSAMPLED_SESSION });
      page.healthAnswered();
      page.entryRan();
      page.showLoadingScreen("session");
      await passStallThreshold();

      const [span] = page.spans();
      expect(attributeOf(span, ATTR_BOOT_OUTCOME)).toBe("stalled");
      expect(attributeOf(span, "langwatch.boot.health")).toBe("ok");
      expect(attributeOf(span, "langwatch.boot.health_ms")).toBe(60);
      expect(attributeOf(span, "langwatch.boot.entry_ran")).toBe(true);
      expect(attributeOf(span, "langwatch.boot.loading_screen")).toBe("session");
      expect(attributeOf(span, "langwatch.boot.release")).toBe("git-11111111");
      expect(attributeOf(span, "langwatch.boot.current_release")).toBe("git-6391517b");
      expect(attributeOf(span, "langwatch.boot.slowest_file")).toBe("index-a1.js");
      expect(attributeOf(span, "langwatch.boot.pending_files")).toBe("chunk-b2.js");
      expect(attributeOf(span, "langwatch.boot.wait_ms")).toBeGreaterThanOrEqual(BOOT_STALL_MS);
    });

    /** @scenario "A stalled boot that later draws is reported as recovered" */
    it("reports the late page as recovered in the same trace", async () => {
      const page = bootPage({ session: UNSAMPLED_SESSION });
      await passStallThreshold();
      await vi.advanceTimersByTimeAsync(4000);
      page.drawn();

      const [stalled, recovered] = page.spans();
      expect(attributeOf(recovered, ATTR_BOOT_OUTCOME)).toBe("recovered");
      expect(recovered?.traceId).toBe(stalled?.traceId);
      expect(attributeOf(recovered, "langwatch.boot.drawn_ms")).toBeGreaterThan(BOOT_STALL_MS);
    });
  });

  describe("when the page draws while the stall's release lookup is still out", () => {
    /** @scenario "A stalled boot that later draws is reported as recovered" */
    it("sends the stall as it stood at the threshold, before the recovery", async () => {
      const page = bootPage({ session: UNSAMPLED_SESSION, servedRelease: "hang" });
      page.showLoadingScreen("organizations");
      await passStallThreshold();
      page.drawn();

      const [stalled, recovered] = page.spans();
      expect(attributeOf(stalled, ATTR_BOOT_OUTCOME)).toBe("stalled");
      expect(attributeOf(stalled, "langwatch.boot.loading_screen")).toBe("organizations");
      expect(attributeOf(stalled, "langwatch.boot.drawn_ms")).toBeUndefined();
      expect(attributeOf(stalled, "langwatch.boot.current_release")).toBe("unknown");
      expect(attributeOf(recovered, ATTR_BOOT_OUTCOME)).toBe("recovered");
    });
  });

  describe("given browser tracing is off", () => {
    /** @scenario "Nothing is reported while browser tracing is off" */
    it("sends nothing, even for a stall", async () => {
      const page = bootPage({ tracing: false });
      await passStallThreshold();
      page.unload();
      expect(page.spans()).toEqual([]);
    });
  });

  describe("when a script file fails to load", () => {
    /** @scenario "A code file that failed to load is named in the report" */
    it("names the file without its address or query", async () => {
      const page = bootPage();
      const script = document.createElement("script");
      script.src = "https://cdn.test/git-11111111/assets/chunk-Xy9.js?retry=2";
      page.fail(script);
      await passStallThreshold();
      expect(attributeOf(page.spans()[0], "langwatch.boot.failed_files")).toBe("chunk-Xy9.js");
    });
  });

  describe("given an address with an id and a query", () => {
    /** @scenario "The report carries the path without ids or query values" */
    it("replaces the id and keeps only the query's names", async () => {
      const page = bootPage({
        pathname: "/acme/messages/trace_8f3a9b2c",
        search: "?langy=open&langyPrompt=why%20the%20zebra%20stalls",
      });
      await passStallThreshold();
      const [span] = page.spans();
      expect(attributeOf(span, "url.path")).toBe("/:project/messages/:trace");
      expect(attributeOf(span, "langwatch.boot.query_keys")).toBe("langy,langyPrompt");
      expect(JSON.stringify(span)).not.toContain("zebra");
      expect(JSON.stringify(span)).not.toContain("acme");
    });
  });

  describe("when the page is hidden before it drew", () => {
    /** @scenario "A tab hidden while still loading is reported as hidden" */
    it("reports the boot as hidden", async () => {
      const page = bootPage({ session: UNSAMPLED_SESSION });
      await vi.advanceTimersByTimeAsync(2000);
      page.hide();
      const [span] = page.spans();
      expect(attributeOf(span, ATTR_BOOT_OUTCOME)).toBe("hidden");
      expect(attributeOf(span, "langwatch.boot.visibility")).toBe("hidden");
    });
  });

  describe("when the page unloads before it drew", () => {
    /** @scenario "A page closed while still loading is reported as abandoned" */
    it("reports the boot as abandoned", async () => {
      const page = bootPage({ session: UNSAMPLED_SESSION });
      await vi.advanceTimersByTimeAsync(3000);
      page.unload();
      page.hide();
      expect(page.spans().map((span) => attributeOf(span, ATTR_BOOT_OUTCOME))).toEqual([
        "abandoned",
      ]);
    });

    /** @scenario "A page the boot recovery reloads is reported as reloaded" */
    it("reports a reload the boot recovery counted as reloaded", async () => {
      const page = bootPage({ session: UNSAMPLED_SESSION, attempts: "1,1" });
      page.store.set("ui-boot-attempt", "2,2");
      page.unload();
      const [span] = page.spans();
      expect(attributeOf(span, ATTR_BOOT_OUTCOME)).toBe("reloaded");
      expect(attributeOf(span, "langwatch.boot.recovery_reloads")).toBe(1);
    });
  });

  describe("given a browser without sendBeacon", () => {
    /** @scenario "Without sendBeacon the report goes by a keepalive fetch" */
    it("posts the report with a keepalive fetch carrying the session", async () => {
      const page = bootPage({ beacon: "missing" });
      await passStallThreshold();
      const [post] = page.posts;
      expect(post?.init.keepalive).toBe(true);
      expect(new Headers(post?.init.headers).get(RUM_SESSION_HEADER)).toBe(SAMPLED_SESSION);
      expect(attributeOf(page.spans()[0], ATTR_BOOT_OUTCOME)).toBe("stalled");
    });
  });

  describe("given a browser that can send nothing", () => {
    /** @scenario "A browser that can send nothing still boots" */
    it("raises no error", async () => {
      const page = bootPage({ beacon: "missing", fetchAvailable: false });
      await expect(passStallThreshold()).resolves.toBeUndefined();
      page.unload();
      expect(page.spans()).toEqual([]);
    });
  });
});
