import { describe, expect, it } from "vitest";

import { isPreciseResourceHref, toRelativeSameOriginHref } from "../index";

describe("toRelativeSameOriginHref", () => {
  it("preserves the path, query and hash of a same-origin URL", () => {
    expect(
      toRelativeSameOriginHref({
        url: "https://app.langwatch.ai/demo/messages/t1?tab=spans#span-2",
        origin: "https://app.langwatch.ai",
      }),
    ).toBe("/demo/messages/t1?tab=spans#span-2");
  });

  it("rejects foreign, malformed, relative and opaque-origin URLs", () => {
    expect(
      toRelativeSameOriginHref({
        url: "https://evil.example.com/demo/simulations",
        origin: "https://app.langwatch.ai",
      }),
    ).toBeNull();
    expect(
      toRelativeSameOriginHref({
        url: "localhost:3000/demo/simulations/set_1/batch_1",
        origin: "localhost:3000",
      }),
    ).toBeNull();
    expect(
      toRelativeSameOriginHref({
        url: "/demo/simulations",
        origin: "https://app.langwatch.ai",
      }),
    ).toBeNull();
    expect(
      toRelativeSameOriginHref({
        url: "not a url",
        origin: "https://app.langwatch.ai",
      }),
    ).toBeNull();
  });
});

describe("isPreciseResourceHref", () => {
  it("distinguishes a surface index from a concrete resource address", () => {
    expect(isPreciseResourceHref("https://app.langwatch.ai/demo/simulations")).toBe(
      false,
    );
    expect(isPreciseResourceHref("/demo/simulations")).toBe(false);
    expect(isPreciseResourceHref("/demo/datasets/ds_123")).toBe(true);
    expect(
      isPreciseResourceHref(
        "/demo/agents?drawer.open=agentCodeEditor&drawer.agentId=ag_1",
      ),
    ).toBe(true);
  });
});
