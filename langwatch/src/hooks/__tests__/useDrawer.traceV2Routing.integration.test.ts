/**
 * @vitest-environment jsdom
 *
 * Integration test for the central Trace Explorer default routing inside
 * `openDrawer`. Exercises the real hook and the real `qs` URL serialization —
 * only the router is harnessed (to capture the navigation it would perform
 * and to stand on different pages).
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push, replace, router } = vi.hoisted(() => {
  const push = vi.fn();
  const replace = vi.fn();
  return {
    push,
    replace,
    router: {
      query: {},
      pathname: "/[project]/experiments",
      asPath: "/test-project/experiments/exp-1",
      push,
      replace,
    },
  };
});

vi.mock("~/utils/compat/next-router", () => {
  return { default: router, useRouter: () => router };
});

import { useDrawer } from "../useDrawer";

function lastOpenedUrl(): string {
  expect(push).toHaveBeenCalled();
  return String(push.mock.calls[push.mock.calls.length - 1]?.[0]);
}

describe("openDrawer Trace Explorer default routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    router.pathname = "/[project]/experiments";
  });

  describe("given the open happens outside the legacy Traces page", () => {
    describe("when opening a trace's details from a results view", () => {
      /** @scenario "A trace opened from a results view uses the Trace Explorer" */
      it("rewrites the open to the Trace Explorer drawer in the URL", () => {
        const { result } = renderHook(() => useDrawer());

        act(() => {
          result.current.openDrawer("traceDetails", { traceId: "trace-abc" });
        });

        const url = lastOpenedUrl();
        expect(url).toMatch(/drawer\.open=traceV2Details/);
        expect(url).toContain("trace-abc");
        expect(url).not.toMatch(/drawer\.open=traceDetails(?![a-zA-Z])/);
      });
    });

    describe("when opening a trace from the evaluation results View action", () => {
      it("routes to the Trace Explorer and drops the legacy-only tab param", () => {
        const { result } = renderHook(() => useDrawer());

        // Mirrors the exact payload the eval results "View" button sends.
        act(() => {
          result.current.openDrawer("traceDetails", {
            traceId: "trace-eval",
            selectedTab: "traceDetails",
          });
        });

        const url = lastOpenedUrl();
        expect(url).toMatch(/drawer\.open=traceV2Details/);
        expect(url).toContain("trace-eval");
        expect(url).not.toContain("selectedTab");
      });
    });
  });

  describe("given the open happens on the legacy Traces page", () => {
    beforeEach(() => {
      router.pathname = "/[project]/messages";
    });

    describe("when opening a trace's details from the legacy traces table", () => {
      /** @scenario "Opening a trace from the legacy Traces page uses the legacy drawer" */
      it("keeps the open on the legacy drawer in the URL", () => {
        const { result } = renderHook(() => useDrawer());

        act(() => {
          result.current.openDrawer("traceDetails", { traceId: "trace-abc" });
        });

        const url = lastOpenedUrl();
        expect(url).toMatch(/drawer\.open=traceDetails/);
        expect(url).toContain("trace-abc");
        expect(url).not.toContain("traceV2Details");
      });
    });
  });
});
