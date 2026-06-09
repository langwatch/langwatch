/**
 * @vitest-environment jsdom
 *
 * Integration test for the central traces-v2 opt-in routing inside
 * `openDrawer`. Exercises the real hook, the real `getTracesV2Preferred`
 * localStorage read, and the real `qs` URL serialization — only the router is
 * harnessed (to capture the navigation it would perform).
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push, replace } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("~/utils/compat/next-router", () => {
  const router = {
    query: {},
    asPath: "/test-project/experiments/exp-1",
    push,
    replace,
  };
  return { default: router, useRouter: () => router };
});

import { setTracesV2Preferred } from "../../features/traces-v2/hooks/useTracesV2Preference";
import { useDrawer } from "../useDrawer";

function lastOpenedUrl(): string {
  expect(push).toHaveBeenCalled();
  return String(push.mock.calls[push.mock.calls.length - 1]?.[0]);
}

describe("openDrawer traces-v2 opt-in routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  describe("given the device has opted into traces v2", () => {
    beforeEach(() => {
      setTracesV2Preferred(true);
    });

    describe("when opening a trace's details from a results view", () => {
      /** @scenario "A trace opened from a results view uses the new explorer when the device opted in" */
      it("rewrites the open to the v2 drawer in the URL", () => {
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
      /** @scenario "Viewing a trace from evaluation results honors the opt-in" */
      it("routes to v2 and drops the legacy-only tab param", () => {
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

  describe("given the device has not opted into traces v2", () => {
    describe("when opening a trace's details from a results view", () => {
      /** @scenario "A trace opened from a results view uses the legacy drawer when the device has not opted in" */
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
