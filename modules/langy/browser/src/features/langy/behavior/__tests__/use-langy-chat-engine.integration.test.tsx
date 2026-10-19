/**
 * useLangyChatEngine invalidates dashboard queries when a Langy turn settles.
 * @see specs/langy/langy-dashboard-widget-refresh.feature
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dashboardWidgetsListInvalidate = vi.fn(() => Promise.resolve());
const graphsGetAllInvalidate = vi.fn(() => Promise.resolve());

let chatStatus = "idle";
let chatMessages: unknown[] = [];

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: chatMessages,
    sendMessage: vi.fn(),
    stop: vi.fn(),
    status: chatStatus,
    setMessages: vi.fn(),
    error: null,
    regenerate: vi.fn(),
    clearError: vi.fn(),
  }),
}));

vi.mock("../../../../behavior/langy-api.ts", () => ({
  api: {
    useUtils: () => ({
      dashboardWidgets: { list: { invalidate: dashboardWidgetsListInvalidate } },
      graphs: { getAll: { invalidate: graphsGetAllInvalidate } },
    }),
  },
}));

import { useLangyChatEngine } from "../use-langy-chat-engine.ts";

describe("useLangyChatEngine", () => {
  beforeEach(() => {
    dashboardWidgetsListInvalidate.mockClear();
    graphsGetAllInvalidate.mockClear();
    chatStatus = "idle";
    chatMessages = [];
  });

  describe("when a turn transitions from streaming to ready", () => {
    /** @scenario "An open dashboard refetches its widgets when Langy's turn settles" */
    it("invalidates both dashboard widgets and graphs queries", () => {
      chatStatus = "streaming";

      const { rerender } = renderHook(() => useLangyChatEngine({ transport: {} as never }));

      expect(dashboardWidgetsListInvalidate).not.toHaveBeenCalled();
      expect(graphsGetAllInvalidate).not.toHaveBeenCalled();

      chatStatus = "ready";
      rerender();

      expect(dashboardWidgetsListInvalidate).toHaveBeenCalledTimes(1);
      expect(graphsGetAllInvalidate).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a turn transitions from streaming to error", () => {
    /** @scenario "A failed turn still refetches the dashboard when it settles" */
    it("invalidates both dashboard widgets and graphs queries", () => {
      chatStatus = "streaming";

      const { rerender } = renderHook(() => useLangyChatEngine({ transport: {} as never }));

      expect(dashboardWidgetsListInvalidate).not.toHaveBeenCalled();
      expect(graphsGetAllInvalidate).not.toHaveBeenCalled();

      chatStatus = "error";
      rerender();

      expect(dashboardWidgetsListInvalidate).toHaveBeenCalledTimes(1);
      expect(graphsGetAllInvalidate).toHaveBeenCalledTimes(1);
    });
  });

  describe("when status remains ready after a rerender", () => {
    /** @scenario "A settled turn does not refetch again on later renders" */
    it("does not re-invalidate", () => {
      chatStatus = "streaming";

      const { rerender } = renderHook(() => useLangyChatEngine({ transport: {} as never }));

      chatStatus = "ready";
      rerender();

      expect(dashboardWidgetsListInvalidate).toHaveBeenCalledTimes(1);
      expect(graphsGetAllInvalidate).toHaveBeenCalledTimes(1);

      rerender();

      expect(dashboardWidgetsListInvalidate).toHaveBeenCalledTimes(1);
      expect(graphsGetAllInvalidate).toHaveBeenCalledTimes(1);
    });
  });
});
