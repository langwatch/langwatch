// @vitest-environment jsdom
import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { operationSchema } from "../model/operation-schema.ts";
import { EndpointStateProvider } from "../ui/endpoint-state.tsx";
import { Playground } from "../ui/playground.tsx";

const APP = "https://app.example.test";

vi.hoisted(() => {
  /* The build defines the app the docs connect to; here the test names one. */
  Object.assign(globalThis, { __DOCS_APP_ORIGIN__: "https://app.example.test" });
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

/* Only `closed` and `close` are read from the popup; jsdom opens no real windows. */
const fakePopup = () => ({ closed: false, close: () => {} }) as Window;
let popup: Window | null;
let opened: string[] = [];
const fetches: { url: string; init: RequestInit }[] = [];
let answer = { status: 200, body: "{}" };

const status = () => document.querySelector("[data-docs-session-status]")?.textContent ?? "";
const connectButton = () => document.querySelector<HTMLElement>("[data-docs-session-connect]");
const disconnectButton = () =>
  document.querySelector<HTMLElement>("[data-docs-session-disconnect]");
/* Long enough for a stubbed fetch, its body and the playground's state update. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const state = () => new URL(opened.at(-1) ?? APP).searchParams.get("state") ?? "";
const grant = (overrides: Record<string, unknown> = {}) => ({
  type: "langwatch:docs-session",
  version: 1,
  state: state(),
  outcome: "granted",
  token: "sk-lw-docs-session-0123456789",
  expiresAt: "2026-10-26T12:05:00.000Z",
  expiresIn: 300,
  project: { id: "project_1", name: "Checkout agent" },
  ...overrides,
});
function post({ data, origin = APP, source }: { data: unknown; origin?: string; source?: Window }) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin,
      source: source ?? popup,
    }),
  );
}

async function connected() {
  connectButton()?.click();
  post({ data: grant() });
  await settle();
}

beforeEach(async () => {
  opened = [];
  fetches.length = 0;
  answer = { status: 200, body: "{}" };
  popup = fakePopup();
  vi.spyOn(window, "open").mockImplementation((url) => {
    opened.push(String(url));
    return popup;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      fetches.push({ url: String(url), init });
      return new Response(answer.body, { status: answer.status });
    }),
  );
  if (document.getElementById("try-it-button")?.getAttribute("aria-expanded") !== "true") {
    await act(async () => document.getElementById("try-it-button")?.click());
  }
});

/* A consent window still open blocks the next attempt, as it does for a reader. */
async function closePopup() {
  if (!connectButton()?.hasAttribute("disabled")) return;
  if (popup) Object.assign(popup, { closed: true });
  await vi.waitFor(() => expect(connectButton()?.hasAttribute("disabled")).toBe(false));
}

/* Sends the form and waits for the playground to show the answer. */
async function send() {
  const before = fetches.length;
  await act(async () => document.getElementById("pg-send")?.click());
  await vi.waitFor(() => expect(fetches.length).toBe(before + 1));
  await settle();
}

afterEach(async () => {
  await closePopup();
  if (disconnectButton()?.hidden === false) disconnectButton()?.click();
  await settle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("when I connect with my account", () => {
  /** @scenario "Connect with my account" */
  it("opens the app's consent page with a fresh single-use state", () => {
    connectButton()?.click();
    const url = new URL(opened[0] ?? "");
    expect(`${url.origin}${url.pathname}`).toBe(`${APP}/connect/docs`);
    expect(url.searchParams.get("origin")).toBe(location.origin);
    expect(state()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  /** @scenario "Connect with my account" */
  it("waits for one answer at a time and uses a new state for each attempt", async () => {
    connectButton()?.click();
    connectButton()?.click();
    expect(opened).toHaveLength(1);
    await closePopup();
    popup = fakePopup();
    connectButton()?.click();
    expect(opened).toHaveLength(2);
    expect(state()).not.toBe(new URL(opened[0] ?? "").searchParams.get("state"));
  });

  /** @scenario "Connect with my account" */
  it("shows the project and sends requests to the app's API as me, without cookies", async () => {
    await connected();
    expect(status()).toMatch(/^Sending as you in Checkout agent\. Access ends within 5 minutes\./);
    await send();
    const sent = fetches.at(-1);
    expect(sent?.url).toBe(`${APP}/api/traces`);
    expect(new Headers(sent?.init.headers).get("X-Auth-Token")).toBe(grant().token);
    expect(sent?.init.credentials).toBe("omit");
    expect(sent?.init.redirect).toBe("error");
  });
});

describe("when a message is not the expected answer", () => {
  /** @scenario "Ignore any message that is not the expected answer" */
  it("ignores another origin, another window, a stale state and a malformed body", async () => {
    connectButton()?.click();
    post({ data: grant(), origin: "https://evil.example.test" });
    post({ data: grant(), source: window });
    post({ data: grant({ state: "x".repeat(43) }) });
    post({ data: grant({ token: 42 }) });
    post({ data: "granted" });
    await settle();
    expect(status()).toBe("Waiting for LangWatch…");
    post({ data: grant() });
    await settle();
    expect(status()).toMatch(/Checkout agent/);
  });
});

describe("when the key would leak", () => {
  /** @scenario "Keep the key out of every place it could leak" */
  it("keeps it out of the URL, storage, the examples and the page", async () => {
    await connected();
    const token = grant().token;
    expect(location.href).not.toContain(token);
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain(token);
    expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain(token);
    expect(document.body.innerHTML).not.toContain(token);
    expect(opened.join(" ")).not.toContain(token);
  });
});

describe("when connecting does not work", () => {
  /** @scenario "Fall back to a pasted key when connecting does not work" */
  it("says the popup was blocked", async () => {
    popup = null;
    connectButton()?.click();
    await settle();
    expect(status()).toMatch(/blocked the LangWatch window/);
    expect(document.getElementById("pg-auth")?.closest("[hidden]")).toBeNull();
  });

  /** @scenario "Fall back to a pasted key when connecting does not work" */
  it("says the member denied access", async () => {
    connectButton()?.click();
    post({
      data: { type: "langwatch:docs-session", version: 1, state: state(), outcome: "denied" },
    });
    await settle();
    expect(status()).toMatch(/did not allow access/);
  });

  /** @scenario "Fall back to a pasted key when connecting does not work" */
  it("says the window closed, or that LangWatch did not answer in time", async () => {
    vi.useFakeTimers();
    try {
      connectButton()?.click();
      if (popup) Object.assign(popup, { closed: true });
      await vi.advanceTimersByTimeAsync(600);
      expect(status()).toMatch(/closed before access was granted/);
      popup = fakePopup();
      connectButton()?.click();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(status()).toMatch(/did not answer within two minutes/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("when access ends", () => {
  /** @scenario "End the connection when access ends" */
  it("clears the key when a request answers 401, and asks for consent again", async () => {
    await connected();
    answer = { status: 401, body: "{}" };
    await send();
    expect(status()).toMatch(/Your access ended/);
    expect(connectButton()?.hidden).toBe(false);
    connectButton()?.click();
    expect(opened).toHaveLength(2);
  });

  /** @scenario "End the connection when access ends" */
  it("clears the key when it expires", async () => {
    vi.useFakeTimers();
    try {
      connectButton()?.click();
      post({ data: grant({ expiresIn: 1 }) });
      await vi.advanceTimersByTimeAsync(1_500);
      expect(status()).toMatch(/Your access ended/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("when my access does not allow a request", () => {
  /** @scenario "Say so when my access does not allow a request" */
  it("says so on a 403 and stays connected without retrying", async () => {
    await connected();
    answer = { status: 403, body: "{}" };
    await send();
    expect(status()).toMatch(/does not allow this request/);
    expect(fetches).toHaveLength(1);
    expect(disconnectButton()?.hidden).toBe(false);
  });
});

describe("when I disconnect", () => {
  /** @scenario "Disconnect revokes the key on the app" */
  it("clears the key at once and asks the app to revoke it with the key itself", async () => {
    await connected();
    disconnectButton()?.click();
    expect(connectButton()?.hidden).toBe(false);
    await settle();
    const revoke = fetches.at(-1);
    expect(revoke?.url).toBe(`${APP}/api/docs-session`);
    expect(revoke?.init.method).toBe("DELETE");
    expect(new Headers(revoke?.init.headers).get("X-Auth-Token")).toBe(grant().token);
    expect(status()).toBe("Disconnected.");
  });

  /** @scenario "Disconnect revokes the key on the app" */
  it("says the disconnection was local when the app cannot be reached", async () => {
    await connected();
    answer = { status: 503, body: "" };
    disconnectButton()?.click();
    await settle();
    expect(status()).toMatch(/Disconnected in this tab.*within five minutes/);
  });
});
