import { describe, expect, it } from "vitest";

import { postHogConfig } from "../browser/posthog.ts";
import {
  analyticsConsented,
  startTagManager,
  TAG_RESTRICTIONS,
  tagManagerId,
} from "../browser/tag-manager.ts";

/* A window double with just the surface the loader touches. */
function fakeWindow({
  id,
  host = "langwatch.ai",
  ready = "complete",
  consent = "accepted",
}: {
  id: string;
  host?: string;
  ready?: string;
  /** The stored cookie choice; null for none, "throws" for storage the browser refuses. */
  consent?: string | null;
}) {
  const listeners = new Map<string, ((event?: unknown) => void)[]>();
  const stored = { value: consent };
  const appended: { src: string; async: boolean; onload?: () => void }[] = [];
  const idle: (() => void)[] = [];
  const doc = {
    readyState: ready,
    querySelector: () => (id ? { content: id } : null),
    createElement: () => ({ src: "", async: false }),
    head: {
      append: (script: { src: string; async: boolean; onload?: () => void }) =>
        appended.push(script),
    },
  };
  const win = {
    document: doc,
    location: { hostname: host, origin: `https://${host}` },
    fbq: undefined as { queue: unknown[][] } | undefined,
    Reo: undefined as { init: (options: { clientID: string }) => void } | undefined,
    posthog: undefined as (unknown[] & { _i?: [string, object, string][] }) | undefined,
    localStorage: {
      getItem: (key: string) => {
        if (stored.value === "throws") throw new Error("SecurityError");
        return key === "lw-cookie-consent" ? stored.value : null;
      },
    },
    dataLayer: undefined as unknown[] | undefined,
    addEventListener: (name: string, listener: (event?: unknown) => void) =>
      listeners.set(name, [...(listeners.get(name) ?? []), listener]),
    removeEventListener: (name: string, listener: (event?: unknown) => void) =>
      listeners.set(
        name,
        (listeners.get(name) ?? []).filter((entry) => entry !== listener),
      ),
    requestIdleCallback: (callback: () => void) => idle.push(callback),
    setTimeout: (callback: () => void) => idle.push(callback),
  };
  const fire = (name: string, event?: unknown) =>
    (listeners.get(name) ?? []).forEach((listener) => listener(event));
  return { win, appended, idle, fire, stored, listeners };
}

describe("the tag manager loader", () => {
  describe("when a production page names a container", () => {
    /** @scenario "Load the tag manager without slowing the page" */
    it("adds nothing until the reader interacts, then the tag exactly once", () => {
      const { win, appended, fire, idle } = fakeWindow({ id: "GTM-KJ4S6Z9C" });
      startTagManager({ win: win as never });
      expect(appended).toEqual([]);
      fire("pointerdown");
      fire("keydown");
      idle.forEach((callback) => callback());
      expect(appended.map(({ src, async }) => ({ src, async }))).toEqual([
        { src: "https://www.googletagmanager.com/gtm.js?id=GTM-KJ4S6Z9C", async: true },
        { src: "https://langwatch.ai/ingest/static/array.js", async: true },
        { src: "https://connect.facebook.net/en_US/fbevents.js", async: true },
        { src: "https://static.reo.dev/a4d64a7a8ea3125/reo.js", async: true },
      ]);
      expect(win.dataLayer).toEqual([
        TAG_RESTRICTIONS,
        expect.objectContaining({ event: "gtm.js" }),
      ]);
    });

    /** @scenario "Load the tag manager without slowing the page" */
    it("loads after the page is idle when the reader never interacts", () => {
      const { win, appended, idle, fire } = fakeWindow({ id: "GTM-KJ4S6Z9C", ready: "loading" });
      startTagManager({ win: win as never });
      expect(idle).toHaveLength(0);
      fire("load");
      expect(appended).toEqual([]);
      idle.forEach((callback) => callback());
      expect(appended).toHaveLength(4);
    });
  });

  describe("when the page names no container or runs on a local host", () => {
    /** @scenario "Load the tag manager without slowing the page" */
    it("never loads a tag", () => {
      const doc = (id: string) => ({ querySelector: () => (id ? { content: id } : null) }) as never;
      expect(tagManagerId({ doc: doc(""), host: "langwatch.ai" })).toBe("");
      expect(tagManagerId({ doc: doc("GTM-KJ4S6Z9C"), host: "localhost" })).toBe("");
      expect(
        tagManagerId({ doc: doc("GTM-KJ4S6Z9C"), host: "app.docs-site.langwatch.localhost" }),
      ).toBe("");
      expect(tagManagerId({ doc: doc("<script>"), host: "langwatch.ai" })).toBe("");
      expect(tagManagerId({ doc: doc("GTM-KJ4S6Z9C"), host: "langwatch.ai" })).toBe("GTM-KJ4S6Z9C");
    });
  });

  describe("when the reader has not accepted cookies", () => {
    /** @scenario "Load the tag manager only after the reader accepted cookies" */
    it.each([
      ["has not chosen", null],
      ["declined", "declined"],
      ["has storage the browser refuses", "throws"],
    ])("loads no tag when the reader %s", (_label, consent) => {
      const { win, appended, fire, idle } = fakeWindow({ id: "GTM-KJ4S6Z9C", consent });
      startTagManager({ win: win as never });
      fire("pointerdown");
      fire("load");
      idle.forEach((callback) => callback());
      expect(appended).toEqual([]);
      expect(win.dataLayer).toBeUndefined();
      expect(win.posthog).toBeUndefined();
    });

    /** @scenario "Load the tag manager only after the reader accepted cookies" */
    it("starts once the reader accepts in another tab, and not for another key", () => {
      const { win, appended, fire, idle, stored } = fakeWindow({
        id: "GTM-KJ4S6Z9C",
        consent: null,
      });
      startTagManager({ win: win as never });
      fire("storage", { key: "something-else" });
      stored.value = "accepted";
      fire("storage", { key: "something-else" });
      expect(idle).toHaveLength(0);
      fire("storage", { key: "lw-cookie-consent" });
      fire("pointerdown");
      fire("storage", { key: "lw-cookie-consent" });
      idle.forEach((callback) => callback());
      expect(appended).toHaveLength(4);
    });
  });

  describe("when the reader accepted cookies", () => {
    /** @scenario "Load the tag manager only after the reader accepted cookies" */
    it("reads the choice the marketing site stored", () => {
      const storage = (value: string | null) =>
        ({ localStorage: { getItem: () => value } }) as never;
      expect(analyticsConsented({ win: storage("accepted") })).toBe(true);
      expect(analyticsConsented({ win: storage("yes") })).toBe(false);
    });
  });

  describe("when the container loads", () => {
    /** @scenario "Refuse arbitrary code from the tag manager" */
    it("refuses Custom HTML and custom JavaScript before the container starts", () => {
      const { win, fire } = fakeWindow({ id: "GTM-KJ4S6Z9C" });
      startTagManager({ win: win as never });
      fire("pointerdown");

      const [restrictions, start] = win.dataLayer ?? [];
      expect(start).toMatchObject({ event: "gtm.js" });
      expect(restrictions).toEqual({ "gtm.blocklist": ["html", "customScripts"] });
    });
  });

  describe("when the tag manager starts", () => {
    /** @scenario "Load PostHog with the tag manager, through the site's own proxy" */
    it("queues PostHog's start for its loader and loads it from the proxy, without recordings", () => {
      const { win, appended, fire } = fakeWindow({ id: "GTM-KJ4S6Z9C" });
      startTagManager({ win: win as never });
      fire("pointerdown");

      expect(appended.map(({ src }) => src)).toContain(
        "https://langwatch.ai/ingest/static/array.js",
      );
      const [[key, config, name] = []] = win.posthog?._i ?? [];
      expect(key).toMatch(/^phc_/);
      expect(name).toBe("posthog");
      expect(config).toEqual(postHogConfig({ origin: "https://langwatch.ai" }));
      expect(config).toMatchObject({
        api_host: "https://langwatch.ai/ingest",
        capture_pageview: "history_change",
        disable_session_recording: true,
      });
    });

    /** @scenario "Load PostHog with the tag manager, through the site's own proxy" */
    it("leaves a PostHog the page already has alone", () => {
      const { win, appended, fire } = fakeWindow({ id: "GTM-KJ4S6Z9C" });
      const existing: unknown[] = [];
      win.posthog = existing;
      startTagManager({ win: win as never });
      fire("pointerdown");
      expect(win.posthog).toBe(existing);
      expect(appended.map(({ src }) => src)).not.toContain(
        "https://langwatch.ai/ingest/static/array.js",
      );
    });
  });

  describe("when the tag manager starts the tags the docs refuse to run as custom HTML", () => {
    /** @scenario "Load the Meta pixel and Reo.dev from the page, not from the tag manager" */
    it("queues Meta's pixel start and a page view, and starts Reo.dev once its script loads", () => {
      const { win, appended, fire } = fakeWindow({ id: "GTM-KJ4S6Z9C" });
      startTagManager({ win: win as never });
      fire("pointerdown");

      expect(win.fbq?.queue).toEqual([
        ["init", "2744447795854475"],
        ["track", "PageView"],
      ]);
      const reo = appended.find(({ src }) => src.startsWith("https://static.reo.dev/"));
      const started: { clientID: string }[] = [];
      win.Reo = { init: (options) => started.push(options) };
      reo?.onload?.();
      expect(started).toEqual([{ clientID: "a4d64a7a8ea3125" }]);
    });

    /** @scenario "Load the Meta pixel and Reo.dev from the page, not from the tag manager" */
    it("loads neither before the reader accepted cookies", () => {
      const { win, appended, fire, idle } = fakeWindow({ id: "GTM-KJ4S6Z9C", consent: null });
      startTagManager({ win: win as never });
      fire("pointerdown");
      idle.forEach((callback) => callback());
      expect(appended).toEqual([]);
      expect(win.fbq).toBeUndefined();
    });
  });
});
