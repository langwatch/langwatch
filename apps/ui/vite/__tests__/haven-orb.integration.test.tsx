// @vitest-environment jsdom
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { havenOrb, havenOrbTags } from "../haven-orb";
import orbBuildConfig from "../haven-orb.config";
import { buildFeedback, feedbackSchema, havenEndpoint, postToHaven } from "../haven-orb/feedback";
import { readDock } from "../haven-orb/langy-dock";
import { OrbIsland } from "../haven-orb/orb-panel";
import { hideForSession, isHiddenForSession } from "../haven-orb/orb-prefs";
import {
  attachPageBuffer,
  networkEntrySchema,
  PAGE_BUFFER_LIMIT,
  type PageBuffer,
} from "../haven-orb/page-buffer";
import { pickElement } from "../haven-orb/pickers";
import { orbShell, whenAppPainted } from "../haven-orb/reveal";

const realFetch = window.fetch;
let buffer: PageBuffer | undefined;

const attach = () => {
  buffer = attachPageBuffer({ host: window });
  return buffer;
};

afterEach(() => {
  cleanup();
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
        injectTo: "head",
        attrs: { type: "module" },
      });
      expect(tag?.attrs?.src).toMatch(/^\/@fs\/.*haven-orb\/orb-client\.ts$/u);
    });

    /** @scenario "absent in production" */
    it("applies to the dev server alone, never to a build", () => {
      expect(havenOrb({ slug: "feat-x" }).apply).toBe("serve");
    });

    /** @scenario "absent in production" */
    it("builds the built-UI orb in memory only, never into the bundle's directory", () => {
      expect(orbBuildConfig.build?.write).toBe(false);
      expect(orbBuildConfig.build?.outDir).toBeUndefined();
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

  describe("given a capture", () => {
    /** @scenario "a capture of the selection travels with the note" */
    it("carries the PNG data URL and refuses any other image", () => {
      const image = "data:image/png;base64,iVBORw0KGgo=";
      const feedback = buildFeedback({
        note: "icon blurry",
        subject: { kind: "region", box: { x: 0, y: 0, width: 10, height: 10 } },
        buffer: attach(),
        host: window,
        image,
      });
      expect(feedbackSchema.parse(feedback).image).toBe(image);
      expect(feedbackSchema.validate({ ...feedback, image: "data:image/svg+xml,<svg/>" })).toBe(
        false,
      );
    });
  });

  describe("given the element picker", () => {
    /** @scenario "the element picker labels what it would pick" */
    it("reports the hovered element's test id and size, and Escape cancels", async () => {
      document.body.innerHTML = `<section data-testid="traces-table"><span>row</span></section>`;
      const span = document.querySelector("span");
      if (!span) throw new Error("the fixture has no span");
      document.elementFromPoint = () => span;
      const onHover = vi.fn();
      const picked = pickElement({ host: window, isOwn: () => false, onHover });
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(await picked).toBeUndefined();
      expect(onHover).toHaveBeenCalledWith(
        expect.objectContaining({ tag: "span", testId: "traces-table", box: expect.any(Object) }),
      );
    });
  });

  describe("given the panel", () => {
    const mount = ({ send }: { send: typeof fetch }) => {
      const shell = document.createElement("div");
      document.body.append(shell);
      const endpoint = havenEndpoint({
        location: new URL("https://app.feat-x.langwatch.localhost/"),
      });
      const orb = { host: window, buffer: attach(), send, endpoint };
      renderWithDesignSystem(<OrbIsland orb={orb} shell={shell} onHide={() => undefined} />);
    };

    /** @scenario "the panel says plainly when haven does not answer" */
    it("shows one line with a retry that asks haven again", async () => {
      const send = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      });
      mount({ send });
      fireEvent.click(screen.getByRole("button", { name: "Haven dev tools" }));
      expect(await screen.findByText("Haven is not answering for this stack.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    });

    /** @scenario "the panel says plainly when haven does not answer" */
    it("asks haven again when the reader reopens an offline orb", async () => {
      const send = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      });
      mount({ send });
      const orb = screen.getByRole("button", { name: "Haven dev tools" });
      fireEvent.click(orb);
      expect(await screen.findByText("Haven is not answering for this stack.")).toBeTruthy();
      fireEvent.click(orb);
      fireEvent.click(orb);
      await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    });

    /** @scenario "the panel lists the stack's facts and consoles" */
    /** @scenario "the orb shows each service's health" */
    it("reads as ready when a database address has no scheme", async () => {
      const facts = {
        slug: "feat-x",
        branch: "feat/x",
        commit: "abc1234",
        links: [
          { label: "mail", href: "https://mail.feat-x.langwatch.localhost", status: "live" },
          { label: "postgres", href: "postgres.feat-x.langwatch.localhost:5432" },
        ],
      };
      mount({ send: vi.fn(async () => Response.json(facts)) });
      fireEvent.click(screen.getByRole("button", { name: "Haven dev tools" }));
      expect(await screen.findByText("feat/x · abc1234")).toBeTruthy();
      expect(screen.queryByText("Haven is not answering for this stack.")).toBeNull();
      expect(screen.queryByRole("link", { name: /mail/u })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Sims/u }));
      expect(screen.getByRole("link", { name: /mail/u }).getAttribute("href")).toBe(
        "https://mail.feat-x.langwatch.localhost",
      );
      expect(screen.getByText("live")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /Data/u }));
      expect(screen.getByTitle("Copy postgres.feat-x.langwatch.localhost:5432")).toBeTruthy();
    });

    /** @scenario "the orb stands alone without Langy's launcher" */
    it("places a 36px orb 20px off the bottom-right corner", () => {
      mount({ send: vi.fn(async () => new Response("{}", { status: 404 })) });
      const orb = screen.getByRole("button", { name: "Haven dev tools" });
      const point = orb.parentElement;
      if (!point) throw new Error("the orb has no dock point");
      expect(getComputedStyle(orb).width).toBe("36px");
      const { right, bottom } = getComputedStyle(point);
      expect({ right, bottom }).toEqual({ right: "38px", bottom: "38px" });
    });
  });

  describe("given Langy's launcher", () => {
    const launcher = ({ left, top }: { left: number; top: number }) => {
      document.body.innerHTML = `<button data-langy-orb></button>`;
      const element = document.querySelector<HTMLElement>("[data-langy-orb]");
      if (!element) throw new Error("the fixture has no launcher");
      for (const [key, value] of Object.entries({
        offsetWidth: 46,
        offsetLeft: left,
        offsetTop: top,
      }))
        Object.defineProperty(element, key, { configurable: true, value });
    };

    /** @scenario "the orb docks to Langy's launcher" */
    it("puts the satellite on the launcher's upper rim, facing the page", () => {
      launcher({ left: window.innerWidth - 66, top: window.innerHeight - 66 });
      const dock = readDock({ host: window });
      expect(dock).toMatchObject({ mirrored: false, edge: 49 });
      expect(dock?.left).toBe(window.innerWidth - 43 - 26);
      expect(dock?.top).toBe(window.innerHeight - 43 - 26);
    });

    /** @scenario "the orb docks to Langy's launcher" */
    it("mirrors to the right of the rim while the launcher dodges to the left", () => {
      launcher({ left: 20, top: window.innerHeight - 66 });
      expect(readDock({ host: window })).toMatchObject({ left: 43 + 26, mirrored: true });
    });
  });

  describe("given the page loading", () => {
    /** @scenario "the orb waits for the app to paint" */
    it("reveals the orb only once the app renders into #root", async () => {
      document.body.innerHTML = `<div id="root"></div>`;
      const onPainted = vi.fn();
      whenAppPainted({ doc: document, onPainted });
      expect(onPainted).not.toHaveBeenCalled();
      document.getElementById("root")?.append(document.createElement("main"));
      await waitFor(() => expect(onPainted).toHaveBeenCalledTimes(1));
    });

    /** @scenario "the orb stays clickable above the app's overlays" */
    it("mounts the orb in a fixed shell on the topmost layer", () => {
      const shell = orbShell({ doc: document });
      expect(shell.parentElement).toBe(document.body);
      expect(getComputedStyle(shell)).toMatchObject({ position: "fixed", zIndex: "2147483647" });
    });
  });

  describe("given the panel's preferences", () => {
    /** @scenario "hiding the orb lasts for the tab's session" */
    it("keeps the orb hidden in session storage, not across tabs", () => {
      expect(isHiddenForSession({ host: window })).toBe(false);
      hideForSession({ host: window });
      expect(isHiddenForSession({ host: window })).toBe(true);
      expect(localStorage.length).toBe(0);
    });
  });
});
