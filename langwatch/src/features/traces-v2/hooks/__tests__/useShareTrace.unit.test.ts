// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useShareTrace } from "../useShareTrace";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  revoke: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      share: { listForResource: { invalidate: mocks.invalidate } },
    }),
    share: {
      listForResource: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      createShare: {
        useMutation: () => ({ mutate: mocks.create, isLoading: false }),
      },
      revoke: {
        useMutation: () => ({ mutate: mocks.revoke, isLoading: false }),
      },
    },
  },
}));

describe("useShareTrace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when creating a link with the conversation included", () => {
    /** @scenario Sharing a trace together with its thread */
    it("keeps the trace as the resource and adds the explicit thread capability", () => {
      const { result } = renderHook(() =>
        useShareTrace({
          projectId: "project-1",
          traceId: "trace-1",
          conversationId: "conv-1",
        }),
      );

      act(() => {
        result.current.createLink({
          visibility: "PUBLIC",
          expiry: "never",
          singleView: false,
          includeThread: true,
        });
      });

      expect(mocks.create).toHaveBeenCalledWith({
        projectId: "project-1",
        resourceType: "TRACE",
        resourceId: "trace-1",
        threadId: "conv-1",
        visibility: "PUBLIC",
        expiresAt: null,
        maxViews: null,
      });
    });
  });

  describe("when creating an ordinary trace link", () => {
    it("does not grant access to the surrounding conversation", () => {
      const { result } = renderHook(() =>
        useShareTrace({
          projectId: "project-1",
          traceId: "trace-1",
          conversationId: "conv-1",
        }),
      );

      act(() => {
        result.current.createLink({
          visibility: "PUBLIC",
          expiry: "never",
          singleView: false,
          includeThread: false,
        });
      });

      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: null }),
      );
    });
  });
});
