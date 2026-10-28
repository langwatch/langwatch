/**
 * useLangyChatEngine refreshes the app lists a Langy write touched, as the result lands.
 * @see specs/langy/langy-dashboard-widget-refresh.feature
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invalidateProcedure = vi.fn((_path: string) => Promise.resolve());

let chatMessages: unknown[] = [];

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: chatMessages,
    sendMessage: vi.fn(),
    stop: vi.fn(),
    status: "streaming",
    setMessages: vi.fn(),
    error: null,
    regenerate: vi.fn(),
    clearError: vi.fn(),
  }),
}));

vi.mock("@langwatch/api/web", () => ({ useInvalidateProcedure: () => invalidateProcedure }));

vi.mock("../../../../behavior/langy-api.ts", () => ({
  api: {
    useUtils: () => ({
      dashboardWidgets: { list: { invalidate: vi.fn(() => Promise.resolve()) } },
      graphs: { getAll: { invalidate: vi.fn(() => Promise.resolve()) } },
    }),
  },
}));

import { useLangyChatEngine } from "../use-langy-chat-engine.ts";

const transport = {} as Parameters<typeof useLangyChatEngine>[0]["transport"];

const toolMessage = ({
  command,
  state = "output-available",
  id = "call-1",
}: {
  command: string;
  state?: string;
  id?: string;
}) => ({
  id: `m-${id}`,
  role: "assistant",
  parts: [
    {
      type: "dynamic-tool",
      toolName: "bash",
      toolCallId: id,
      state,
      input: { command },
      output: "{}",
    },
  ],
});

const invalidatedPaths = () => invalidateProcedure.mock.calls.map(([path]) => path).toSorted();

describe("useLangyChatEngine write refresh", () => {
  beforeEach(() => {
    invalidateProcedure.mockClear();
    chatMessages = [];
  });

  describe("when Langy creates a scenario", () => {
    /** @scenario "A scenario Langy creates refreshes the scenario and suite lists" */
    it("invalidates the scenarios and suites queries", () => {
      chatMessages = [toolMessage({ command: "langwatch scenario create --name Refunds --json" })];
      renderHook(() => useLangyChatEngine({ transport }));

      expect(invalidatedPaths()).toEqual(["scenarios", "suites"]);
    });
  });

  describe("when Langy creates a test suite", () => {
    /** @scenario "A suite Langy creates refreshes the suite and scenario lists" */
    it("invalidates the suites and scenarios queries", () => {
      chatMessages = [
        toolMessage({ command: "langwatch test-suite create --name default --json" }),
      ];
      renderHook(() => useLangyChatEngine({ transport }));

      expect(invalidatedPaths()).toEqual(["scenarios", "suites"]);
    });
  });

  describe("when Langy only reads", () => {
    /** @scenario "A read does not refresh anything" */
    it("invalidates nothing", () => {
      chatMessages = [toolMessage({ command: "langwatch scenario list --json" })];
      renderHook(() => useLangyChatEngine({ transport }));

      expect(invalidateProcedure).not.toHaveBeenCalled();
    });
  });

  describe("when the write has not returned yet", () => {
    it("invalidates nothing", () => {
      chatMessages = [
        toolMessage({ command: "langwatch scenario create --name A", state: "input-available" }),
      ];
      renderHook(() => useLangyChatEngine({ transport }));

      expect(invalidateProcedure).not.toHaveBeenCalled();
    });
  });

  describe("when the panel re-renders with the same result", () => {
    /** @scenario "A write is refreshed once, not on every render" */
    it("does not invalidate again", () => {
      chatMessages = [toolMessage({ command: "langwatch scenario create --name A" })];
      const { rerender } = renderHook(() => useLangyChatEngine({ transport }));
      rerender();

      expect(invalidateProcedure).toHaveBeenCalledTimes(2);
    });
  });
});
