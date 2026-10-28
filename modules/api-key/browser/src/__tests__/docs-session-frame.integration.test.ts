// @vitest-environment node
/**
 * The docs session frame's runtime, run as served: its inline script executes in a window at
 * the app's origin, with the docs page and the consent popup as real windows beside it.
 */
import { buildDocsSessionFrameDocument } from "@langwatch/api-key-contract/docs-session-frame";
// @ts-expect-error -- jsdom ships no types and the workspace has none; its slice is typed below.
import { JSDOM as UntypedJSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

type DOMWindow = Window & typeof globalThis;
const JSDOM = UntypedJSDOM as new (
  html: string,
  options: { url: string; runScripts?: "dangerously"; beforeParse?: (window: DOMWindow) => void },
) => { window: DOMWindow };

const APP = "https://app.langwatch.ai";
const DOCS = "https://langwatch.ai";
const TOKEN = "sk-lw-docs-session-0123456789";

type Posted = { message: Record<string, unknown>; targetOrigin: string };
type Sent = { url: string; init: RequestInit };

const opened: DOMWindow[] = [];
afterEach(() => {
  for (const window of opened.splice(0)) window.close();
});

function blankWindow(url: string): DOMWindow {
  const window = new JSDOM("<!doctype html>", { url }).window;
  opened.push(window);
  return window;
}

function mountFrame({
  embedded = true,
  popupBlocked = false,
  respond = () => new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
  timings = { confirmDelayMs: 40, connectTimeoutMs: 2_000, requestTimeoutMs: 2_000 },
}: {
  embedded?: boolean;
  popupBlocked?: boolean;
  respond?: (sent: Sent) => Response | Promise<Response>;
  timings?: Partial<Record<"confirmDelayMs" | "connectTimeoutMs" | "requestTimeoutMs", number>>;
} = {}) {
  const docs = blankWindow(`${DOCS}/docs/api-reference`);
  const popup = blankWindow(`${APP}/connect/docs`);
  const toDocs: Posted[] = [];
  docs.postMessage = ((message: Record<string, unknown>, targetOrigin: string) =>
    toDocs.push({ message, targetOrigin })) as never;
  const popups: string[] = [];
  const sent: Sent[] = [];

  const dom = new JSDOM(
    buildDocsSessionFrameDocument({ nonce: "n0nce", embedder: DOCS, timings }),
    {
      url: `${APP}/connect/docs/frame?origin=${encodeURIComponent(DOCS)}`,
      runScripts: "dangerously",
      beforeParse(window) {
        if (embedded) Object.defineProperty(window, "parent", { value: docs });
        window.open = ((url: string) => {
          popups.push(url);
          return popupBlocked ? null : popup;
        }) as never;
        window.fetch = (async (url: string, init: RequestInit) => {
          const entry = { url: String(url), init };
          sent.push(entry);
          if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
          return new Promise<Response>((resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
            void Promise.resolve(respond(entry)).then(resolve, reject);
          });
        }) as never;
      },
    },
  );
  const frame = dom.window;
  opened.push(frame);
  const byId = (id: string) => frame.document.getElementById(id) as HTMLElement;

  const fromDocs = (
    data: Record<string, unknown>,
    { origin = DOCS, source = docs as unknown } = {},
  ) =>
    frame.dispatchEvent(
      new frame.MessageEvent("message", {
        data: { type: "langwatch:docs-frame", version: 1, ...data },
        origin,
        source: source as never,
      }),
    );
  const fromPopup = (data: unknown, { origin = APP, source = popup as unknown } = {}) =>
    frame.dispatchEvent(
      new frame.MessageEvent("message", { data, origin, source: source as never }),
    );
  const state = () => new URL(popups.at(-1) ?? "about:blank").searchParams.get("state") ?? "";
  const grant = (overrides: Record<string, unknown> = {}) => ({
    type: "langwatch:docs-session",
    version: 1,
    state: state(),
    outcome: "granted",
    token: TOKEN,
    expiresAt: "2026-10-28T12:05:00.000Z",
    expiresIn: 300,
    project: { id: "proj-1", name: "Checkout" },
    ...overrides,
  });
  /** A reader's press: it begins with the pointer going down, then clicks. */
  const press = (button: HTMLElement) => {
    button.dispatchEvent(new frame.Event("pointerdown"));
    button.click();
  };
  const connect = () => {
    byId("connect").click();
    fromPopup(grant());
  };
  const states = () =>
    toDocs.filter((entry) => entry.message.kind === "state").map((entry) => entry.message);
  const answers = (id: string) =>
    toDocs.filter((entry) => entry.message.id === id).map((entry) => entry.message);

  return {
    frame,
    docs,
    popup,
    popups,
    toDocs,
    sent,
    byId,
    press,
    fromDocs,
    fromPopup,
    grant,
    state,
    connect,
    states,
    answers,
  };
}

describe("the docs session frame", () => {
  describe("when the API host serves it", () => {
    /** @scenario "The frame runs only the code it was served with" */
    it("carries the answer's nonce on every inline tag, so its own policy runs it", () => {
      const html = buildDocsSessionFrameDocument({ nonce: "n0nce", embedder: DOCS });

      const { document } = new JSDOM(html, { url: APP }).window;
      const inline = [...document.querySelectorAll("script, style")].map((tag) => [
        tag.tagName,
        [...tag.attributes].map(({ name, value }) => `${name}=${value}`),
      ]);
      expect(inline).toEqual([
        ["STYLE", ["nonce=n0nce"]],
        ["SCRIPT", ["nonce=n0nce"]],
      ]);
      expect(html).not.toMatch(/\son[a-z]+=|javascript:|<script[^>]+src=/i);
      expect(() => buildDocsSessionFrameDocument({ nonce: '"><b>', embedder: DOCS })).toThrow(
        "invalid docs frame nonce",
      );
    });
  });

  describe("given the frame is embedded by a registered docs origin", () => {
    /** @scenario "Connecting runs the consent flow from inside the frame" */
    it("opens the consent page with a fresh state and tells the docs only that it is connected", () => {
      const { byId, popups, state, fromPopup, grant, states, toDocs } = mountFrame();
      expect(states().at(-1)).toMatchObject({ connected: false, project: null });

      byId("connect").click();
      const url = new URL(popups[0]!);
      expect(`${url.origin}${url.pathname}`).toBe(`${APP}/connect/docs`);
      expect(url.searchParams.get("origin")).toBe(DOCS);
      expect(state()).toMatch(/^[A-Za-z0-9_-]{43}$/);

      fromPopup(grant());

      expect(states().at(-1)).toMatchObject({ connected: true, project: "Checkout" });
      expect(byId("status").textContent).toMatch(/Sending as you in Checkout/);
      expect(toDocs.every((entry) => entry.targetOrigin === DOCS)).toBe(true);
      expect(JSON.stringify(toDocs)).not.toContain(TOKEN);
    });

    /** @scenario "Connecting runs the consent flow from inside the frame" */
    it("asks for a new state on every connection", () => {
      const { byId, popups, fromPopup, grant } = mountFrame();
      byId("connect").click();
      fromPopup({
        ...grant(),
        outcome: "denied",
        token: undefined,
        expiresAt: undefined,
        expiresIn: undefined,
        project: undefined,
      });
      byId("connect").click();

      const [first, second] = popups.map((url) => new URL(url).searchParams.get("state"));
      expect(first).not.toBe(second);
    });
  });

  describe("given the frame is waiting for the consent popup", () => {
    /** @scenario "The frame ignores any answer that is not the expected one" */
    it("ignores another origin, another window, another state and a malformed body", () => {
      const { byId, fromPopup, grant, states, docs } = mountFrame();
      byId("connect").click();

      fromPopup(grant(), { origin: DOCS });
      fromPopup(grant(), { source: docs });
      fromPopup(grant({ state: "B".repeat(43) }));
      fromPopup(grant({ token: "short" }));
      fromPopup(grant({ expiresIn: -1 }));
      fromPopup("not an object");
      expect(states().some((state) => state.connected)).toBe(false);
      expect(byId("status").textContent).toBe("Waiting for LangWatch…");

      fromPopup(grant());
      expect(states().at(-1)).toMatchObject({ connected: true });
    });
  });

  describe("when connecting does not work", () => {
    /** @scenario "The frame reports why connecting did not work" */
    it("says the popup was blocked", () => {
      const { byId, states } = mountFrame({ popupBlocked: true });
      byId("connect").click();

      expect(byId("status").textContent).toMatch(/blocked the LangWatch window/);
      expect(states().at(-1)).toMatchObject({ connected: false });
    });

    /** @scenario "The frame reports why connecting did not work" */
    it("says the reader did not allow access", () => {
      const { byId, fromPopup, state } = mountFrame();
      byId("connect").click();
      fromPopup({ type: "langwatch:docs-session", version: 1, state: state(), outcome: "denied" });

      expect(byId("status").textContent).toMatch(/did not allow access/);
    });

    /** @scenario "The frame reports why connecting did not work" */
    it("says the window closed before answering", async () => {
      const { byId, popup } = mountFrame();
      byId("connect").click();
      // jsdom tears a closed window down, so stand in for the reader closing it.
      Object.defineProperty(popup, "closed", { value: true });

      // The frame looks at the popup every half second.
      await vi.waitFor(() => expect(byId("status").textContent).toMatch(/closed before access/), {
        timeout: 2_000,
      });
    });

    /** @scenario "The frame reports why connecting did not work" */
    it("gives up when the consent page stays silent", async () => {
      const { byId } = mountFrame({ timings: { connectTimeoutMs: 50 } });
      byId("connect").click();

      await vi.waitFor(() => expect(byId("status").textContent).toMatch(/did not answer/));
    });

    /** @scenario "The frame reports why connecting did not work" */
    it("offers nothing to connect when it is not embedded", () => {
      const { byId, popups } = mountFrame({ embedded: false });
      byId("connect").click();

      expect(popups).toEqual([]);
      expect(byId("status").textContent).toMatch(/from the API playground/);
    });
  });

  describe("given the frame is connected", () => {
    /** @scenario "The frame sends a read for the docs page at once" */
    it("sends a GET to the app's own origin with the key and no cookies, and answers with the response", async () => {
      const { connect, fromDocs, sent, answers } = mountFrame();
      connect();

      fromDocs({
        kind: "send",
        id: "r1",
        method: "GET",
        path: "/api/v1/dataset?page=2",
        headers: { Accept: "application/json" },
        body: null,
      });

      await vi.waitFor(() => expect(answers("r1")).toHaveLength(1));
      expect(sent).toHaveLength(1);
      expect(sent[0]!.url).toBe("/api/v1/dataset?page=2");
      expect(sent[0]!.init).toMatchObject({
        method: "GET",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
      expect(sent[0]!.init.headers).toEqual({ Accept: "application/json", "X-Auth-Token": TOKEN });
      expect(answers("r1")[0]).toMatchObject({
        kind: "response",
        status: 200,
        body: '{"ok":true}',
        contentType: "application/json",
      });
    });

    /** @scenario "A request that changes data waits for the reader inside the frame" */
    it("names the method, path and project, and sends a POST only once the reader presses Send", async () => {
      const { connect, fromDocs, sent, byId, answers, press } = mountFrame({
        timings: { confirmDelayMs: 40 },
      });
      connect();

      fromDocs({
        kind: "send",
        id: "w1",
        method: "POST",
        path: "/api/v1/dataset",
        headers: {},
        body: '{"name":"x"}',
      });
      expect(byId("confirm").hidden).toBe(false);
      expect(byId("confirm-text").textContent).toBe(
        "Send POST /api/v1/dataset as you in Checkout?",
      );
      expect(sent).toEqual([]);

      press(byId("confirm-send"));
      expect(sent).toEqual([]);

      await new Promise((resolve) => setTimeout(resolve, 60));
      press(byId("confirm-send"));
      await vi.waitFor(() => expect(answers("w1")).toHaveLength(1));
      expect(sent[0]!.init).toMatchObject({ method: "POST", body: '{"name":"x"}' });
      expect(byId("confirm").hidden).toBe(true);
    });

    /** @scenario "A request that changes data waits for the reader inside the frame" */
    it("ignores a press that began before the delay ran out, and does not move focus to Send", async () => {
      const {
        connect,
        fromDocs,
        sent,
        byId,
        frame: frameWindow,
      } = mountFrame({
        timings: { confirmDelayMs: 40 },
      });
      connect();
      fromDocs({
        kind: "send",
        id: "w3",
        method: "POST",
        path: "/api/v1/dataset",
        headers: {},
        body: "{}",
      });
      expect(frameWindow.document.activeElement).not.toBe(byId("confirm-send"));

      byId("confirm-send").dispatchEvent(new frameWindow.Event("pointerdown"));
      await new Promise((resolve) => setTimeout(resolve, 60));
      byId("confirm-send").click();

      expect(sent).toEqual([]);
      expect(byId("confirm").hidden).toBe(false);
    });

    /** @scenario "A request that changes data waits for the reader inside the frame" */
    it("answers that the reader declined when they press Cancel", () => {
      const { connect, fromDocs, sent, byId, answers } = mountFrame();
      connect();
      fromDocs({
        kind: "send",
        id: "w2",
        method: "DELETE",
        path: "/api/v1/dataset/1",
        headers: {},
        body: null,
      });

      byId("confirm-cancel").click();

      expect(sent).toEqual([]);
      expect(answers("w2")).toEqual([
        expect.objectContaining({ kind: "failed", reason: "declined" }),
      ]);
    });

    /** @scenario "The frame refuses what it was not built to send" */
    it("refuses a request that reuses the id of one still waiting", () => {
      const { connect, fromDocs, answers } = mountFrame();
      connect();
      const write = {
        kind: "send",
        id: "w4",
        method: "POST",
        path: "/api/v1/dataset",
        headers: {},
        body: "{}",
      };
      fromDocs(write);
      fromDocs({ ...write, method: "GET", body: null });

      expect(answers("w4")).toEqual([
        expect.objectContaining({ kind: "failed", reason: "refused" }),
      ]);
    });

    /** @scenario "The frame refuses what it was not built to send" */
    it("sends nothing for another sender, a path outside /api, another origin or an unknown method", () => {
      const { connect, fromDocs, sent, popup, answers } = mountFrame();
      connect();

      fromDocs(
        { kind: "send", id: "x1", method: "GET", path: "/api/v1/dataset" },
        { origin: "https://evil.example" },
      );
      fromDocs(
        { kind: "send", id: "x2", method: "GET", path: "/api/v1/dataset" },
        { source: popup },
      );
      fromDocs({ kind: "send", id: "x3", method: "GET", path: "/settings" });
      fromDocs({ kind: "send", id: "x4", method: "GET", path: "//evil.example/api/x" });
      fromDocs({ kind: "send", id: "x5", method: "GET", path: "https://evil.example/api/x" });
      fromDocs({ kind: "send", id: "x6", method: "TRACE", path: "/api/v1/dataset" });

      expect(sent).toEqual([]);
      expect(answers("x1")).toEqual([]);
      expect(answers("x2")).toEqual([]);
      for (const id of ["x3", "x4", "x5", "x6"])
        expect(answers(id)).toEqual([
          expect.objectContaining({ kind: "failed", reason: "refused" }),
        ]);
    });

    /** @scenario "The frame refuses what it was not built to send" */
    it("drops any credential the docs page names before sending", async () => {
      const { connect, fromDocs, sent } = mountFrame();
      connect();

      fromDocs({
        kind: "send",
        id: "h1",
        method: "GET",
        path: "/api/v1/dataset",
        headers: {
          "x-auth-token": "sk-other",
          Authorization: "Bearer x",
          Cookie: "a=b",
          "X-Trace": "1",
        },
      });

      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0]!.init.headers).toEqual({ "X-Trace": "1", "X-Auth-Token": TOKEN });
    });
  });

  describe("when access ends", () => {
    /** @scenario "The frame ends the connection when access ends" */
    it("clears the key when it expires", async () => {
      const { byId, fromPopup, grant, states } = mountFrame();
      byId("connect").click();
      fromPopup(grant({ expiresIn: 0.05 }));
      expect(states().at(-1)).toMatchObject({ connected: true });

      await vi.waitFor(() => expect(states().at(-1)).toMatchObject({ connected: false }));
      expect(byId("status").textContent).toMatch(/Your access ended/);
    });

    /** @scenario "The frame ends the connection when access ends" */
    it("clears the key on a 401 and explains a 403 without clearing it", async () => {
      let status = 403;
      const { connect, fromDocs, states, byId, answers } = mountFrame({
        respond: () => new Response("{}", { status }),
      });
      connect();

      fromDocs({ kind: "send", id: "f1", method: "GET", path: "/api/v1/dataset" });
      await vi.waitFor(() => expect(answers("f1")).toHaveLength(1));
      expect(byId("status").textContent).toMatch(/access in Checkout does not allow this request/);
      expect(states().at(-1)).toMatchObject({ connected: true });

      status = 401;
      fromDocs({ kind: "send", id: "f2", method: "GET", path: "/api/v1/dataset" });
      await vi.waitFor(() => expect(states().at(-1)).toMatchObject({ connected: false }));
    });

    /** @scenario "The frame ends the connection when access ends" */
    it("revokes the key with itself on Disconnect", async () => {
      const { connect, byId, sent, states } = mountFrame();
      connect();

      byId("disconnect").click();

      expect(states().at(-1)).toMatchObject({ connected: false });
      await vi.waitFor(() => expect(byId("status").textContent).toBe("Disconnected."));
      expect(sent[0]).toMatchObject({
        url: "/api/docs-session",
        init: { method: "DELETE", credentials: "omit" },
      });
      expect(sent[0]!.init.headers).toEqual({ "X-Auth-Token": TOKEN });
    });

    /** @scenario "The frame ends the connection when access ends" */
    it("says the disconnection was local when the app cannot revoke", async () => {
      const { connect, byId } = mountFrame({ respond: () => new Response(null, { status: 500 }) });
      connect();

      byId("disconnect").click();

      await vi.waitFor(() =>
        expect(byId("status").textContent).toMatch(/ends on its own within five minutes/),
      );
    });

    /** @scenario "The frame ends the connection when access ends" */
    it("revokes the key when the frame unloads", () => {
      const { connect, frame, sent } = mountFrame();
      connect();

      frame.dispatchEvent(new frame.Event("pagehide"));

      expect(sent[0]).toMatchObject({
        url: "/api/docs-session",
        init: { method: "DELETE", keepalive: true },
      });
    });

    /** @scenario "The frame ends the connection when access ends" */
    it("answers a request sent while not connected without sending it", () => {
      const { fromDocs, sent, answers } = mountFrame();

      fromDocs({ kind: "send", id: "n1", method: "GET", path: "/api/v1/dataset" });

      expect(sent).toEqual([]);
      expect(answers("n1")).toEqual([
        expect.objectContaining({ kind: "failed", reason: "not-connected" }),
      ]);
    });
  });
});
