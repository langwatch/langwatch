// @vitest-environment jsdom
// The app frames its session document only for the published docs origin.
// @vitest-environment-options {"url": "https://langwatch.ai/docs/api-reference/traces/search"}
import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { operationSchema } from "../model/operation-schema.ts";
import { EndpointStateProvider } from "../ui/endpoint-state.tsx";
import { Playground } from "../ui/playground.tsx";

const APP = "https://app.example.test";
const scrolled = vi.hoisted(() => {
  Object.assign(globalThis, { __DOCS_APP_ORIGIN__: "https://app.example.test" });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const into: Element[] = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    into.push(this);
  };
  Element.prototype.getAnimations = () => [];
  Object.defineProperty(window, "matchMedia", {
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
  return into;
});

const operation = operationSchema.parse({
  method: "POST",
  path: "/api/traces/search",
  origin: "https://app.langwatch.ai",
  summary: "Search traces",
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
      <Playground operation={operation} slug="api-reference/traces/search" />
    </EndpointStateProvider>
  </DesignSystemTestProvider>,
)}<script type="application/json" id="docs-page-data">${JSON.stringify({ operation })}</script>`;
await import("../browser/playground.tsx");

const frame = () => document.querySelector<HTMLIFrameElement>("iframe.docs-session-frame");
const room = () => document.querySelector("[data-docs-playground] [data-docs-session-frame]");
const runtime = () => document.querySelector("[data-docs-runtime]");
const liveResponse = () =>
  document.querySelector('[aria-label="Live response"]')?.textContent ?? "";
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
let sent: Record<string, unknown>[] = [];

function fromFrame(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "langwatch:docs-frame", version: 1, ...data },
        origin: APP,
        source: frame()?.contentWindow,
      }),
    );
  });
}

beforeEach(async () => {
  await act(async () => document.getElementById("try-it-button")?.click());
  vi.spyOn(frame()!.contentWindow!, "postMessage").mockImplementation(((message: never) =>
    sent.push(message)) as never);
  fromFrame({ kind: "state", connected: true, project: "Checkout agent" });
  await settle();
});

describe("given the frame is connected and I send a request that changes data", () => {
  /** @scenario "Lead the reader to the frame's confirmation and back to the response" */
  it("leads me to the frame's confirmation, then back to the response once I confirm", async () => {
    sent = [];
    scrolled.length = 0;
    await act(async () => document.getElementById("pg-send")?.click());
    await vi.waitFor(() => expect(sent.some((message) => message.kind === "send")).toBe(true));
    await settle();
    expect(scrolled.at(-1)).toBe(room());
    expect(liveResponse()).toMatch(/Confirm this request in the LangWatch box above/);
    expect((document.getElementById("pg-send") as HTMLButtonElement).disabled).toBe(true);

    const id = sent.find((message) => message.kind === "send")?.id;
    fromFrame({ kind: "confirmed", id });
    await settle();
    expect(liveResponse()).toMatch(/Waiting for a response/);
    expect(scrolled.at(-1)).toBe(runtime());

    fromFrame({
      kind: "response",
      id,
      status: 200,
      statusText: "OK",
      contentType: "application/json",
      headers: [],
      body: '{"traces":[]}',
      ms: 900,
    });
    await settle();
    expect(liveResponse()).toMatch(/200 OK · 900 ms/);
    expect(scrolled.at(-1)).toBe(runtime());
  });
});
