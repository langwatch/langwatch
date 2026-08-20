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

const { push, router } = vi.hoisted(() => {
  const push = vi.fn();
  return {
    push,
    router: {
      query: {},
      pathname: "/[project]/experiments",
      asPath: "/test-project/experiments/exp-1",
      push,
      replace: vi.fn(),
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

  describe("given a screen opens a trace", () => {
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
      it("routes to the Trace Explorer drawer", () => {
        const { result } = renderHook(() => useDrawer());

        // Mirrors the payload the eval results "View" button sends. The
        // legacy-only `selectedTab` it used to carry is gone from the call
        // site AND from the type; that the funnel drops any such leftover is
        // covered in traceDrawerV2Routing.unit.test.ts, which can pass one.
        act(() => {
          result.current.openDrawer("traceV2Details", {
            traceId: "trace-eval",
          });
        });

        const url = lastOpenedUrl();
        expect(url).toMatch(/drawer\.open=traceV2Details/);
        expect(url).toContain("trace-eval");
        expect(url).not.toContain("selectedTab");
      });
    });
  });

  describe("given the legacy Traces path, which now only redirects", () => {
    beforeEach(() => {
      router.pathname = "/[project]/messages";
    });

    describe("when a trace is opened while that redirect is resolving", () => {
      /** @scenario "The default applies to every trace entry point, not only the traces table" */
      it("still routes to the Trace Explorer drawer", () => {
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
  });
});
