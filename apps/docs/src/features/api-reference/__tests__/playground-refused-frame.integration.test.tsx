// @vitest-environment jsdom
// The CDN origin is not a registered docs origin, so the app would refuse to be framed here.
// @vitest-environment-options {"url": "https://docs-origin.langwatch.ai/docs/"}
import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { operationSchema } from "../model/operation-schema.ts";
import { EndpointStateProvider } from "../ui/endpoint-state.tsx";
import { Playground } from "../ui/playground.tsx";

vi.hoisted(() => {
  Object.assign(globalThis, { __DOCS_APP_ORIGIN__: "https://app.example.test" });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {};
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

describe("when the docs are served from an origin the app does not frame", () => {
  /** @scenario "Offer only the pasted key where the app would refuse to be framed" */
  it("opens the playground without asking for the frame and keeps the pasted key", async () => {
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
    await act(async () => document.getElementById("try-it-button")?.click());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(document.querySelector("iframe.docs-session-frame")).toBeNull();
    expect(document.getElementById("pg-auth")).not.toBeNull();
  });
});
