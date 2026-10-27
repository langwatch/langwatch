// @vitest-environment jsdom
/**
 * An aggregate project is read only (ADR-177): every path to a new lens (the toolbar, an
 * AI search) meets the store and its bridge, which add no lens and send nothing.
 * @see specs/governance/aggregate-project.feature
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useExplorerStore } from "../../../../behavior/explorer.store.ts";
import { useAiTraceAction } from "../../../../ui/sections/explorer/ai/use-ai-trace-action.ts";
import { useLensSync } from "../use-lens-sync.ts";

const { projectRef, createMutate, aiMutation } = vi.hoisted(() => ({
  projectRef: { current: { id: "proj-1", kind: "application" } },
  createMutate: vi.fn(),
  aiMutation: {
    onSuccess: null as null | ((result: unknown) => void),
  },
}));

vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: projectRef.current,
    hasPermission: () => true,
  }),
}));

vi.mock("../../../../behavior/trace-api.ts", () => ({
  api: {
    useUtils: () => ({
      savedViews: { getAll: { invalidate: vi.fn() } },
    }),
    savedViews: {
      getAll: { useQuery: () => ({ data: undefined }) },
      create: { useMutation: () => ({ mutate: createMutate }) },
      rename: { useMutation: () => ({ mutate: vi.fn() }) },
      delete: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    traces: {
      aiAction: {
        useMutation: (options: { onSuccess: (result: unknown) => void }) => {
          aiMutation.onSuccess = options.onSuccess;
          return { mutate: vi.fn(), isPending: false };
        },
      },
    },
  },
}));

/** Renders the trace list's lens sync alongside the AI search action. */
const renderAiSearch = () =>
  renderHook(() => {
    useLensSync();
    return useAiTraceAction({ mode: "auto" });
  });

/** The AI search answers by asking for a new lens. */
const answerWithCreateLens = (name: string) =>
  act(() => {
    aiMutation.onSuccess?.({ kind: "create_lens", name, query: "" });
  });

const lensNamed = (name: string) =>
  useExplorerStore.getState().allLenses.find((lens) => lens.name === name);

beforeEach(() => {
  createMutate.mockReset();
  aiMutation.onSuccess = null;
  useExplorerStore.getState().setUserLenses([]);
});

afterEach(() => {
  cleanup();
});

describe("useLensSync", () => {
  describe("given an aggregate project", () => {
    describe("when an AI search asks to create a lens", () => {
      /** @scenario "No path creates a lens on the aggregate" */
      it("adds no lens and sends nothing to save", () => {
        projectRef.current = { id: "agg-1", kind: "aggregate" };
        const activeBefore = useExplorerStore.getState().activeLensId;

        const { result } = renderAiSearch();
        act(() => result.current.submit("slow answers"));
        answerWithCreateLens("Slow answers");

        expect(lensNamed("Slow answers")).toBeUndefined();
        expect(useExplorerStore.getState().activeLensId).toBe(activeBefore);
        expect(createMutate).not.toHaveBeenCalled();
      });
    });

    describe("when any other caller asks the store to create a lens", () => {
      /** @scenario "No path creates a lens on the aggregate" */
      it("adds no lens and sends nothing to save", () => {
        projectRef.current = { id: "agg-1", kind: "aggregate" };
        renderAiSearch();

        act(() => {
          useExplorerStore.getState().createLens("By hand");
        });

        expect(lensNamed("By hand")).toBeUndefined();
        expect(createMutate).not.toHaveBeenCalled();
      });
    });
  });

  describe("given an ordinary project", () => {
    describe("when an AI search asks to create a lens", () => {
      /** @scenario "No path creates a lens on the aggregate" */
      it("adds the lens and sends it to be saved", () => {
        projectRef.current = { id: "proj-1", kind: "application" };

        const { result } = renderAiSearch();
        act(() => result.current.submit("slow answers"));
        answerWithCreateLens("Slow answers");

        expect(lensNamed("Slow answers")).toBeDefined();
        expect(createMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "proj-1",
            name: "Slow answers",
          }),
        );
      });
    });
  });
});
