// @vitest-environment jsdom
import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { frameConnection, sendThroughFrame } from "../browser/docs-session.ts";
import { operationSchema } from "../model/operation-schema.ts";
import { EndpointStateProvider } from "../ui/endpoint-state.tsx";
import { Playground } from "../ui/playground.tsx";

const APP = "https://app.example.test";

vi.hoisted(() => {
  /* The build defines the app the docs connect to; here the test names one. */
  Object.assign(globalThis, { __DOCS_APP_ORIGIN__: "https://app.example.test" });
  /* The app frames its session document only for the published docs origin. */
  (globalThis as unknown as { jsdom: { reconfigure(o: { url: string }): void } }).jsdom.reconfigure(
    {
      url: "https://langwatch.ai/docs/api-reference/traces/list",
    },
  );
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {};
  /* The form slides open with the Web Animations API, which jsdom lacks. */
  Element.prototype.getAnimations = () => [];
  Object.defineProperty(window, "matchMedia", {
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

const operation = operationSchema.parse({
  method: "GET",
  path: "/api/traces",
  origin: "https://app.langwatch.ai",
  summary: "List traces",
  description: "",
  deprecated: false,
  schemes: [{ id: "apiKey", type: "apiKey", in: "header", name: "X-Auth-Token" }],
  parameters: [],
  body: null,
  responses: [],
});

document.body.innerHTML = `${renderToStaticMarkup(
  <DesignSystemTestProvider>
    <button type="button" id="try-it-button" aria-expanded="false">
      Try it
    </button>
    <EndpointStateProvider operation={operation}>
      <Playground operation={operation} slug="api-reference/traces/list" />
    </EndpointStateProvider>
  </DesignSystemTestProvider>,
)}<script type="application/json" id="docs-page-data">${JSON.stringify({ operation })}</script>`;
await import("../browser/playground.tsx");

const frame = () => document.querySelector<HTMLIFrameElement>("iframe.docs-session-frame");
const manualKey = () => document.querySelector<HTMLElement>("[data-docs-manual-key]");
/* Every message this page posted to the frame, with the origin it addressed. */
let toFrame: { message: Record<string, unknown>; targetOrigin: string }[] = [];
const fetches: { url: string; init: RequestInit }[] = [];
/* Long enough for the playground's state updates to land. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

function fromFrame(
  data: Record<string, unknown>,
  { origin = APP, source }: { origin?: string; source?: Window | null } = {},
) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "langwatch:docs-frame", version: 1, ...data },
        origin,
        source: source === undefined ? frame()?.contentWindow : source,
      }),
    );
  });
}
async function connectedIn(project: string | null) {
  fromFrame({ kind: "state", connected: project !== null, project });
  await settle();
}
const sends = () => toFrame.filter((entry) => entry.message.kind === "send");

/* Sends the form and waits for the page to ask the frame. */
async function send() {
  const before = sends().length;
  await act(async () => document.getElementById("pg-send")?.click());
  await vi.waitFor(() => expect(sends().length).toBe(before + 1));
}
const liveResponse = () =>
  document.querySelector('[aria-label="Live response"]')?.textContent ?? "";

beforeEach(async () => {
  toFrame = [];
  fetches.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      fetches.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    }),
  );
  if (document.getElementById("try-it-button")?.getAttribute("aria-expanded") !== "true") {
    await act(async () => document.getElementById("try-it-button")?.click());
  }
  const window = frame()?.contentWindow;
  if (window)
    vi.spyOn(window, "postMessage").mockImplementation(((message: never, targetOrigin: string) =>
      toFrame.push({ message, targetOrigin })) as never);
});

afterEach(async () => {
  /* A request left unanswered keeps Send disabled, as it would for a reader. */
  for (const { message } of sends())
    fromFrame({ kind: "failed", id: message.id, reason: "cancelled" });
  await connectedIn(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("when I open the playground on an endpoint that takes X-Auth-Token", () => {
  /** @scenario "Embed the app's session frame where a project key answers" */
  it("embeds the app's session frame for this docs origin", () => {
    const url = new URL(frame()?.src ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(`${APP}/connect/docs/frame`);
    expect(url.searchParams.get("origin")).toBe(location.origin);
    expect(frame()?.referrerPolicy).toBe("no-referrer");
  });

  /** @scenario "Embed the app's session frame where a project key answers" */
  it("keeps a single frame however often the playground opens", async () => {
    await act(async () => document.getElementById("try-it-button")?.click());
    await act(async () => document.getElementById("try-it-button")?.click());
    expect(document.querySelectorAll("iframe.docs-session-frame")).toHaveLength(1);
  });

  /** @scenario "Embed the app's session frame where a project key answers" */
  it("never holds a key: what it sends the frame names none", async () => {
    await connectedIn("Checkout agent");
    await send();
    expect(JSON.stringify(sends())).not.toMatch(/X-Auth-Token|Authorization|sk-lw/i);
    expect(fetches).toEqual([]);
  });

  /** @scenario "Show the frame only once it speaks" */
  it("takes no room until the frame speaks", async () => {
    await act(async () => document.dispatchEvent(new Event("docs:leaving")));
    await act(async () => document.getElementById("try-it-button")?.click());
    expect(frame()?.hasAttribute("data-docs-frame-ready")).toBe(false);
    fromFrame(
      { kind: "state", connected: true, project: "Evil" },
      { origin: "https://evil.example" },
    );
    expect(frame()?.hasAttribute("data-docs-frame-ready")).toBe(false);
    await connectedIn(null);
    expect(frame()?.hasAttribute("data-docs-frame-ready")).toBe(true);
  });

  /** @scenario "Embed the app's session frame where a project key answers" */
  it("sizes the frame as the frame asks", async () => {
    fromFrame({ kind: "height", height: 131.2 });
    expect(frame()?.style.height).toBe("132px");
  });
});

describe("given the frame says it is connected in a project", () => {
  /** @scenario "Send through the frame while it is connected" */
  it("hides the pasted key field", async () => {
    await connectedIn("Checkout agent");
    expect(manualKey()?.hidden).toBe(true);
  });

  /** @scenario "Send through the frame while it is connected" */
  it("asks the frame to send the request, at the app's origin, and shows its answer", async () => {
    await connectedIn("Checkout agent");
    await send();

    const [{ message, targetOrigin }] = sends() as [(typeof toFrame)[number]];
    expect(targetOrigin).toBe(APP);
    expect(message).toMatchObject({
      type: "langwatch:docs-frame",
      version: 1,
      kind: "send",
      method: "GET",
      path: "/api/traces",
      body: null,
    });

    fromFrame({
      kind: "response",
      id: message.id,
      status: 200,
      statusText: "OK",
      contentType: "application/json",
      headers: [["content-type", "application/json"]],
      body: '{"traces":[]}',
      ms: 12,
    });
    await settle();
    expect(liveResponse()).toMatch(/200 OK · 12 ms · application\/json/);
    expect(liveResponse()).toContain('"traces": []');
  });
});

describe("when I open the playground", () => {
  /** @scenario "Keep the playground out of session recordings" */
  it("marks it for Hotjar and PostHog to leave out of recordings", () => {
    const playground = document.querySelector("[data-docs-playground]");
    expect(playground?.hasAttribute("data-hj-suppress")).toBe(true);
    expect(playground?.classList.contains("ph-no-capture")).toBe(true);
  });
});

describe("when the page replaced the frame without leaving", () => {
  /** @scenario "Stop waiting on a frame the page no longer shows" */
  it("answers the next request as not connected", async () => {
    await connectedIn("Checkout agent");
    const shown = frame()!;
    const container = shown.parentElement!;
    shown.remove();
    try {
      const answer = await sendThroughFrame({
        request: { method: "GET", path: "/api/v1/dataset", headers: {}, body: null },
        signal: new AbortController().signal,
      });
      expect(answer).toEqual({ kind: "failed", reason: "not-connected" });
      expect(frameConnection()).toBeNull();
    } finally {
      container.append(shown);
    }
  });
});

describe("when a message does not come from the frame it embedded", () => {
  /** @scenario "Listen only to the frame it embedded" */
  it("ignores another origin and another window", async () => {
    fromFrame(
      { kind: "state", connected: true, project: "Evil" },
      { origin: "https://evil.example" },
    );
    fromFrame({ kind: "state", connected: true, project: "Evil" }, { source: window });
    fromFrame({ kind: "state", connected: "yes", project: "Evil" });
    await settle();
    expect(manualKey()?.hidden).toBe(false);
  });
});

describe("given the frame is not connected", () => {
  /** @scenario "Fall back to the pasted key when the frame is not connected" */
  it("shows the pasted key and sends with it, never through the frame", async () => {
    await connectedIn(null);
    expect(manualKey()?.hidden).toBe(false);
    const input = document.getElementById("pg-auth") as HTMLInputElement;
    await act(async () => {
      input.value = "sk-lw-pasted-0123456789";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => document.getElementById("pg-send")?.click());
    await vi.waitFor(() => expect(fetches).toHaveLength(1));
    expect(new Headers(fetches[0]?.init.headers).get("X-Auth-Token")).toBe(
      "sk-lw-pasted-0123456789",
    );
    expect(sends()).toEqual([]);
  });

  /** @scenario "Fall back to the pasted key when the frame is not connected" */
  it("shows the pasted key again when the connection ends", async () => {
    await connectedIn("Checkout agent");
    await connectedIn(null);
    expect(manualKey()?.hidden).toBe(false);
  });
});

describe("when the reader cancels the request in the frame", () => {
  /** @scenario "Say so when the reader declines a request in the frame" */
  it("says the request was not sent", async () => {
    await connectedIn("Checkout agent");
    await send();
    fromFrame({ kind: "failed", id: sends()[0]?.message.id, reason: "declined" });
    await settle();
    expect(liveResponse()).toMatch(/cancelled this request in the LangWatch frame/);
  });

  /** @scenario "Say so when the reader declines a request in the frame" */
  it("asks the frame to cancel when I cancel here", async () => {
    await connectedIn("Checkout agent");
    await send();
    await settle();
    await act(async () =>
      [...document.querySelectorAll("button")].find((b) => b.textContent === "Cancel")?.click(),
    );
    expect(toFrame.at(-1)?.message).toMatchObject({ kind: "cancel", id: sends()[0]?.message.id });
  });
});

describe("when I leave the page", () => {
  /** @scenario "End the connection when I leave the page" */
  it("removes the frame, which ends its connection", async () => {
    await connectedIn("Checkout agent");
    await act(async () => document.dispatchEvent(new Event("docs:leaving")));
    await settle();
    expect(frame()).toBeNull();
  });
});
