import { describe, expect, it } from "vitest";

import { startTagManager, tagManagerId } from "../browser/tag-manager.ts";

/* A window double with just the surface the loader touches. */
function fakeWindow({
  id,
  host = "langwatch.ai",
  ready = "complete",
}: {
  id: string;
  host?: string;
  ready?: string;
}) {
  const listeners = new Map<string, (() => void)[]>();
  const appended: { src: string; async: boolean }[] = [];
  const idle: (() => void)[] = [];
  const doc = {
    readyState: ready,
    querySelector: () => (id ? { content: id } : null),
    createElement: () => ({ src: "", async: false }),
    head: { append: (script: { src: string; async: boolean }) => appended.push(script) },
  };
  const win = {
    document: doc,
    location: { hostname: host },
    dataLayer: undefined as unknown[] | undefined,
    addEventListener: (name: string, listener: () => void) =>
      listeners.set(name, [...(listeners.get(name) ?? []), listener]),
    removeEventListener: (name: string, listener: () => void) =>
      listeners.set(
        name,
        (listeners.get(name) ?? []).filter((entry) => entry !== listener),
      ),
    requestIdleCallback: (callback: () => void) => idle.push(callback),
    setTimeout: (callback: () => void) => idle.push(callback),
  };
  const fire = (name: string) => (listeners.get(name) ?? []).forEach((listener) => listener());
  return { win, appended, idle, fire };
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
      expect(appended).toEqual([
        { src: "https://www.googletagmanager.com/gtm.js?id=GTM-KJ4S6Z9C", async: true },
      ]);
      expect(win.dataLayer).toEqual([expect.objectContaining({ event: "gtm.js" })]);
    });

    /** @scenario "Load the tag manager without slowing the page" */
    it("loads after the page is idle when the reader never interacts", () => {
      const { win, appended, idle, fire } = fakeWindow({ id: "GTM-KJ4S6Z9C", ready: "loading" });
      startTagManager({ win: win as never });
      expect(idle).toHaveLength(0);
      fire("load");
      expect(appended).toEqual([]);
      idle.forEach((callback) => callback());
      expect(appended).toHaveLength(1);
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
});
