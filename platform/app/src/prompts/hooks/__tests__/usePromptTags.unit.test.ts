// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePromptTags } from "../usePromptTags";

const queryResult = vi.hoisted(() => ({
  current: { data: undefined as unknown, isLoading: false, refetch: vi.fn() },
}));

vi.mock("~/utils/api", () => ({
  api: {
    promptTags: {
      getAll: {
        useQuery: () => queryResult.current,
      },
    },
  },
}));

describe("usePromptTags", () => {
  beforeEach(() => {
    queryResult.current = {
      data: [
        { id: "production-id", name: "production" },
        { id: "staging-id", name: "staging" },
      ],
      isLoading: false,
      refetch: vi.fn(),
    };
  });

  describe("given the query result is unchanged between renders", () => {
    it("keeps one identity for the tag list", () => {
      // Callers put this list in effect dependencies. A fresh array per render
      // re-runs those effects, whose setState renders again, and the component
      // spins forever instead of settling.
      const { result, rerender } = renderHook(() =>
        usePromptTags({ projectId: "project-1", enabled: true }),
      );
      const first = result.current.data;

      rerender();

      expect(result.current.data).toBe(first);
    });

    it("keeps one identity for an empty tag list", () => {
      queryResult.current = {
        data: undefined,
        isLoading: false,
        refetch: vi.fn(),
      };

      const { result, rerender } = renderHook(() =>
        usePromptTags({ projectId: "project-1", enabled: true }),
      );
      const first = result.current.data;

      rerender();

      expect(result.current.data).toEqual([]);
      expect(result.current.data).toBe(first);
    });
  });

  describe("when the query returns new tags", () => {
    it("maps name and id onto a fresh list", () => {
      const { result, rerender } = renderHook(() =>
        usePromptTags({ projectId: "project-1", enabled: true }),
      );
      const first = result.current.data;

      queryResult.current = {
        data: [{ id: "canary-id", name: "canary" }],
        isLoading: false,
        refetch: vi.fn(),
      };
      rerender();

      expect(result.current.data).not.toBe(first);
      expect(result.current.data).toEqual([{ id: "canary-id", name: "canary" }]);
    });
  });
});
