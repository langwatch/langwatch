// @vitest-environment jsdom
// The CDN origin is not a registered docs origin, so the app would refuse to be framed here.
// @vitest-environment-options {"url": "https://docs-origin.langwatch.ai/docs/"}
import { describe, expect, it, vi } from "vitest";

import { mountFrame } from "../browser/docs-session.ts";

vi.hoisted(() => {
  Object.assign(globalThis, { __DOCS_APP_ORIGIN__: "https://app.langwatch.ai" });
});

describe("when the docs are served from an origin the app does not frame", () => {
  /** @scenario "Offer only the pasted key where the app would refuse to be framed" */
  it("does not embed the session frame, so the browser reports no framing refusal", () => {
    const container = document.createElement("div");
    document.body.append(container);
    mountFrame({ container });
    expect(container.querySelector("iframe")).toBeNull();
  });
});
