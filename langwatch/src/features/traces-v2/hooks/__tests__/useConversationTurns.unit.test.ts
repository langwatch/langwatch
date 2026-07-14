// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useConversationTurns } from "../useConversationTurns";

const state = vi.hoisted(() => ({
  readOnly: true,
  sharedThreadId: "conv-1" as string | null | undefined,
  listOptions: undefined as { enabled?: boolean } | undefined,
  sharedOptions: undefined as { enabled?: boolean } | undefined,
}));

vi.mock("../../context/TraceViewerContext", () => ({
  useTraceViewer: () => ({
    readOnly: state.readOnly,
    sharedThreadId: state.sharedThreadId,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    tracesV2: {
      list: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => {
          state.listOptions = options;
          return {
            data: { items: [{ traceId: "in-app-trace" }] },
            isLoading: false,
          };
        },
      },
      conversationContext: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => {
          state.sharedOptions = options;
          return {
            data: {
              conversationId: "conv-1",
              total: 1,
              turns: [
                {
                  traceId: "shared-trace",
                  timestamp: 1_700_000_000_000,
                  name: "Shared turn",
                  rootSpanType: "llm",
                  status: "ok" as const,
                  input: "question",
                  output: "answer",
                  inputRedacted: false,
                  outputRedacted: false,
                  inputVisibleTo: null,
                  outputVisibleTo: null,
                },
              ],
            },
            isLoading: false,
          };
        },
      },
    },
  },
}));

describe("useConversationTurns", () => {
  beforeEach(() => {
    state.readOnly = true;
    state.sharedThreadId = "conv-1";
    state.listOptions = undefined;
    state.sharedOptions = undefined;
  });

  describe("given a read-only share that includes the conversation", () => {
    it("uses the scoped conversation endpoint and masks list-only metadata", () => {
      const { result } = renderHook(() => useConversationTurns("conv-1"));

      expect(state.listOptions?.enabled).toBe(false);
      expect(state.sharedOptions?.enabled).toBe(true);
      expect(result.current.data?.items).toEqual([
        expect.objectContaining({
          traceId: "shared-trace",
          input: "question",
          output: "answer",
          totalCost: 0,
          totalTokens: 0,
          models: [],
        }),
      ]);
    });
  });

  describe("given an ordinary read-only trace share", () => {
    it("does not query or expose the surrounding conversation", () => {
      state.sharedThreadId = null;

      const { result } = renderHook(() => useConversationTurns("conv-1"));

      expect(state.listOptions?.enabled).toBe(false);
      expect(state.sharedOptions?.enabled).toBe(false);
      expect(result.current.data).toBeUndefined();
    });
  });

  describe("given the live in-app drawer", () => {
    it("keeps using the full project-protected trace list", () => {
      state.readOnly = false;
      state.sharedThreadId = undefined;

      const { result } = renderHook(() => useConversationTurns("conv-1"));

      expect(state.listOptions?.enabled).toBe(true);
      expect(state.sharedOptions?.enabled).toBe(false);
      expect(result.current.data?.items).toEqual([{ traceId: "in-app-trace" }]);
    });
  });
});
