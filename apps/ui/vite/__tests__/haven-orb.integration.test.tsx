// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { havenOrb, havenOrbTags } from "../haven-orb";
import { buildFeedback, feedbackSchema, havenEndpoint, postToHaven } from "../haven-orb/feedback";
import { hideForSession, isHiddenForSession, setTheme } from "../haven-orb/orb-prefs";
import {
  attachPageBuffer,
  networkEntrySchema,
  PAGE_BUFFER_LIMIT,
  type PageBuffer,
} from "../haven-orb/page-buffer";

const realFetch = window.fetch;
let buffer: PageBuffer | undefined;

const attach = () => {
  buffer = attachPageBuffer({ host: window });
  return buffer;
};

afterEach(() => {
  buffer?.detach();
  buffer = undefined;
  window.fetch = realFetch;
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

describe("haven dev orb", () => {
  describe("given the dev server plugin", () => {
    /** @scenario "absent when not run by haven" */
    it("injects no script without haven's stack slug", () => {
      expect(havenOrbTags({ slug: undefined })).toEqual([]);
      expect(havenOrbTags({ slug: "" })).toEqual([]);
    });

    /** @scenario "present when haven runs the stack" */
    it("prepends the orb's module script to the head", () => {
      const [tag] = havenOrbTags({ slug: "feat-x" });
      expect(tag).toMatchObject({
        tag: "script",
        injectTo: "head-prepend",
        attrs: { type: "module" },
      });
      expect(tag?.attrs?.src).toMatch(/^\/@fs\/.*haven-orb\/orb-client\.ts$/u);
    });

    /** @scenario "absent in production" */
    it("applies to the dev server alone, never to a build", () => {
      expect(havenOrb({ slug: "feat-x" }).apply).toBe("serve");
    });
  });

  describe("given the page buffer", () => {
    /** @scenario "network capture never records bodies or headers" */
    it("keeps a request's method, address without query, status and duration only", async () => {
      window.fetch = vi.fn(async () => new Response("{}", { status: 401 }));
      const { network } = attach();
      await window.fetch("https://app.feat-x.langwatch.localhost/api/trpc/x?token=secret#frag", {
        method: "post",
        headers: { Authorization: "Bearer secret", Cookie: "session=secret" },
        body: JSON.stringify({ password: "secret" }),
      });
      expect(networkEntrySchema.strict().parse(network[0])).toMatchObject({
        method: "POST",
        url: "https://app.feat-x.langwatch.localhost/api/trpc/x",
        status: 401,
        failed: true,
      });
      expect(JSON.stringify(network)).not.toContain("secret");
    });

    /** @scenario "console capture leaves the console's output unchanged" */
    it("passes a console call through and keeps it as text", () => {
      const printed = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const entries = attach().console;
      console.error("boom", { code: 7 });
      expect(printed).toHaveBeenCalledWith("boom", { code: 7 });
      expect(entries.at(-1)).toMatchObject({ level: "error", text: 'boom {"code":7}' });
    });

    /** @scenario "the page buffer stays bounded" */
    it("keeps the newest 200 messages", () => {
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      const entries = attach().console;
      for (let line = 0; line < PAGE_BUFFER_LIMIT + 5; line += 1) console.log(`line ${line}`);
      expect(entries).toHaveLength(PAGE_BUFFER_LIMIT);
      expect(entries[0]?.text).toBe("line 5");
    });
  });

  describe("given feedback", () => {
    /** @scenario "feedback on a picked element reaches haven" */
    it("posts the element's selector, the note, the viewport and the page buffer to the stack home", async () => {
      document.body.innerHTML = `<main><button data-testid="save">Save</button></main>`;
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const pageBuffer = attach();
      console.error("render failed");
      const element = document.querySelector("[data-testid=save]");
      if (!element) throw new Error("the fixture has no save button");
      const body = buildFeedback({
        note: "Save sits off-centre",
        subject: { kind: "element", element },
        buffer: pageBuffer,
        host: window,
      });
      const send = vi.fn(
        async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 201 }),
      );
      const url = `${havenEndpoint({ location: new URL("https://app.feat-x.langwatch.localhost:1355/p") }).base}/feedback`;

      expect(await postToHaven({ send, url, body })).toBe(true);
      const [sentTo, init] = send.mock.calls[0] ?? [];
      expect(sentTo).toBe("https://feat-x.langwatch.localhost:1355/api/stacks/feat-x/orb/feedback");
      const sent =
        typeof init?.body === "string" ? feedbackSchema.parse(JSON.parse(init.body)) : undefined;
      expect(sent).toMatchObject({
        note: "Save sits off-centre",
        target: { selector: '[data-testid="save"]', tag: "button", text: "Save" },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        console: [expect.objectContaining({ level: "error", text: "render failed" })],
      });
    });

    /** @scenario "feedback on a selected region reaches haven" */
    it("carries the region's box and the note", () => {
      const box = { x: 10, y: 20, width: 300, height: 40 };
      const feedback = buildFeedback({
        note: "gap too wide",
        subject: { kind: "region", box },
        buffer: attach(),
        host: window,
      });
      expect(feedback).toMatchObject({ note: "gap too wide", region: box });
      expect(feedback.target).toBeUndefined();
    });
  });

  describe("given the panel's preferences", () => {
    /** @scenario "the theme switch follows the reader's choice" */
    it("stores the theme and tells the theme provider through a storage event", () => {
      const heard = vi.fn();
      window.addEventListener("storage", heard);
      setTheme({ host: window, theme: "dark" });
      window.removeEventListener("storage", heard);
      expect(localStorage.getItem("theme")).toBe("dark");
      expect(heard).toHaveBeenCalledWith(
        expect.objectContaining({ key: "theme", newValue: "dark" }),
      );
    });

    /** @scenario "hiding the orb lasts for the tab's session" */
    it("keeps the orb hidden in session storage, not across tabs", () => {
      expect(isHiddenForSession({ host: window })).toBe(false);
      hideForSession({ host: window });
      expect(isHiddenForSession({ host: window })).toBe(true);
      expect(localStorage.length).toBe(0);
    });
  });
});
