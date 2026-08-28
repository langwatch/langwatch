/**
 * @vitest-environment jsdom
 *
 * What `drawer.edit` means to the store-to-URL effect. One parser answers it
 * for both directions, so a URL the store will never enter edit mode from is
 * not treated as edit mode here either.
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  updateDrawerParams: vi.fn(),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawerParams: () => {
    const params: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(harness.query)) {
      if (key.startsWith("drawer.") && key !== "drawer.open") {
        params[key.replace("drawer.", "")] = value;
      }
    }
    return params;
  },
  useUpdateDrawerParams: () => harness.updateDrawerParams,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: harness.query }),
}));

import { useDrawerStore } from "@langwatch/trace-web";
import { useDrawerUrlSync } from "../useDrawerUrlSync";

/** The params an open drawer already carries, so only `drawer.edit` is in play. */
function openOn({ traceId, edit }: { traceId: string; edit?: string }) {
  harness.query = {
    "drawer.open": "traceV2Details",
    "drawer.traceId": traceId,
    "drawer.mode": "summary",
    "drawer.viz": "waterfall",
    ...(edit ? { "drawer.edit": edit } : {}),
  };
}

beforeEach(() => {
  harness.updateDrawerParams.mockClear();
  useDrawerStore.getState().hydrateUrlState({
    viewMode: "summary",
    vizTab: "waterfall",
    selectedSpanId: null,
    pinnedSpanIds: [],
    isEditing: false,
  });
});

describe("useDrawerUrlSync", () => {
  describe("given a sample trace carrying drawer.edit in its URL", () => {
    it("leaves the URL alone, because edit mode never reads that trace", () => {
      openOn({ traceId: "lw-preview-1", edit: "1" });

      renderHook(() => useDrawerUrlSync());

      expect(harness.updateDrawerParams).not.toHaveBeenCalled();
    });
  });

  describe("given a real trace carrying drawer.edit in its URL", () => {
    it("leaves the URL alone once the store is editing it", () => {
      openOn({ traceId: "trace-1", edit: "1" });
      useDrawerStore.getState().setIsEditing(true);

      renderHook(() => useDrawerUrlSync());

      expect(harness.updateDrawerParams).not.toHaveBeenCalled();
    });

    it("drops the param when the store is not editing", () => {
      openOn({ traceId: "trace-1", edit: "1" });

      renderHook(() => useDrawerUrlSync());

      expect(harness.updateDrawerParams).toHaveBeenCalledWith(
        { edit: undefined },
        { push: false },
      );
    });
  });
});
