import { describe, expect, it } from "vitest";

import { startCookieNotice } from "../browser/cookie-notice.ts";

/* A window double with the notice, its two buttons and the surface the tag manager touches. */
function fakeWindow({
  id = "GTM-KJ4S6Z9C",
  host = "langwatch.ai",
  consent = null,
  notice: rendered = true,
}: {
  id?: string;
  host?: string;
  consent?: string | null;
  notice?: boolean;
} = {}) {
  const stored = { value: consent };
  const listeners = new Map<string, ((event?: unknown) => void)[]>();
  const appended: { src: string }[] = [];
  const idle: (() => void)[] = [];
  const button = (choice: string) => {
    const clicks: (() => void)[] = [];
    return {
      dataset: { docsConsent: choice },
      addEventListener: (_name: string, listener: () => void) => clicks.push(listener),
      click: () => clicks.forEach((listener) => listener()),
    };
  };
  const accept = button("accepted");
  const decline = button("declined");
  const notice = { hidden: true, querySelectorAll: () => [accept, decline] };
  const win = {
    document: {
      readyState: "complete",
      getElementById: (name: string) => (rendered && name === "docs-cookie-notice" ? notice : null),
      querySelector: () => (id ? { content: id } : null),
      createElement: () => ({ src: "", async: false }),
      head: { append: (script: { src: string }) => appended.push(script) },
    },
    location: { hostname: host, origin: `https://${host}` },
    localStorage: {
      getItem: (key: string) => (key === "lw-cookie-consent" ? stored.value : null),
      setItem: (key: string, value: string) => {
        if (key === "lw-cookie-consent") stored.value = value;
      },
    },
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
  const settle = () => idle.splice(0).forEach((callback) => callback());
  return { win, notice, accept, decline, stored, appended, fire, settle };
}

describe("the cookie notice", () => {
  describe("when the reader has not chosen on either site", () => {
    /** @scenario "Ask the reader for cookie consent on the docs, sharing the marketing site's choice" */
    it("shows the notice and loads no tag", () => {
      const { win, notice, appended, settle } = fakeWindow();
      startCookieNotice({ win: win as never });
      settle();
      expect(notice.hidden).toBe(false);
      expect(appended).toEqual([]);
    });

    describe("when they accept", () => {
      /** @scenario "Ask the reader for cookie consent on the docs, sharing the marketing site's choice" */
      it("hides the notice, stores the marketing site's value and loads the tag", () => {
        const { win, notice, accept, stored, appended, fire, settle } = fakeWindow();
        startCookieNotice({ win: win as never });
        accept.click();
        fire("pointerdown");
        settle();
        expect(notice.hidden).toBe(true);
        expect(stored.value).toBe("accepted");
        expect(appended.map((script) => script.src)).toContain(
          "https://www.googletagmanager.com/gtm.js?id=GTM-KJ4S6Z9C",
        );
      });
    });

    describe("when they decline", () => {
      /** @scenario "Ask the reader for cookie consent on the docs, sharing the marketing site's choice" */
      it("hides the notice, stores the choice and loads no tag", () => {
        const { win, notice, decline, stored, appended, fire, settle } = fakeWindow();
        startCookieNotice({ win: win as never });
        decline.click();
        fire("pointerdown");
        settle();
        expect(notice.hidden).toBe(true);
        expect(stored.value).toBe("declined");
        expect(appended).toEqual([]);
      });
    });

    describe("when they choose in another tab", () => {
      /** @scenario "Ask the reader for cookie consent on the docs, sharing the marketing site's choice" */
      it("hides the notice here too", () => {
        const { win, notice, stored, fire } = fakeWindow();
        startCookieNotice({ win: win as never });
        stored.value = "declined";
        fire("storage", { key: "lw-cookie-consent" });
        expect(notice.hidden).toBe(true);
      });
    });
  });

  describe("when no notice is due", () => {
    /** @scenario "Ask the reader for cookie consent on the docs, sharing the marketing site's choice" */
    it.each([
      ["the reader accepted on the marketing site", { consent: "accepted" }],
      ["the reader declined on the marketing site", { consent: "declined" }],
      ["the page names no container", { id: "" }],
      ["the page runs on a local host", { host: "app.docs.langwatch.localhost" }],
    ])("keeps the notice hidden when %s", (_label, options) => {
      const { win, notice } = fakeWindow(options);
      startCookieNotice({ win: win as never });
      expect(notice.hidden).toBe(true);
    });

    it("does nothing on a page without the notice", () => {
      const { win } = fakeWindow({ notice: false });
      expect(() => startCookieNotice({ win: win as never })).not.toThrow();
    });
  });
});
