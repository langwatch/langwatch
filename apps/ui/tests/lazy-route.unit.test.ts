// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { lazyRoute } from "../src/behavior/lazy-route";

// jsdom's location.reload() is an inert no-op and location itself cannot be
// spied, so the observable effect of a recovery attempt is the cooldown
// sentinel `forceReloadOnce` writes — the same signal chunk-reload.unit.test.ts
// asserts on.
const RELOAD_AT = "chunk-reload-at";
const reloaded = () => sessionStorage.getItem(RELOAD_AT) !== null;

function Page() {
  return null;
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("given a route module that loads", () => {
  it("hands React Router the module's default export as Component", async () => {
    const route = lazyRoute(() => Promise.resolve({ default: Page }));

    await expect(route.lazy()).resolves.toEqual({ Component: Page });
    expect(reloaded()).toBe(false);
  });
});

describe("given a route chunk that 404s after a deploy", () => {
  it("attempts recovery once and still rejects so the error boundary sees it", async () => {
    const staleChunk = new Error("Failed to fetch dynamically imported module: /assets/a-BJk.js");
    const route = lazyRoute(() => Promise.reject(staleChunk));

    await expect(route.lazy()).rejects.toBe(staleChunk);
    expect(reloaded()).toBe(true);
  });
});

describe("given a route module that throws for an unrelated reason", () => {
  it("rejects without attempting a reload", async () => {
    const failure = new Error("the page threw while evaluating");
    const route = lazyRoute(() => Promise.reject(failure));

    await expect(route.lazy()).rejects.toBe(failure);
    expect(reloaded()).toBe(false);
  });
});
