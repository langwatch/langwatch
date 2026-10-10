/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const addTab = vi.fn();
const fetchResolvedDefault = vi.fn();
const resolvedDefaultQuery: { data: { model: string } | null | undefined } = {
  data: undefined,
};

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      modelProvider: { getResolvedDefault: { fetch: fetchResolvedDefault } },
    }),
    modelProvider: {
      getResolvedDefault: { useQuery: () => resolvedDefaultQuery },
    },
  },
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));
vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({ modelMetadata: {} }),
}));
vi.mock("../../prompt-playground-store/DraggableTabsBrowserStore", () => ({
  useDraggableTabsBrowserStore: (
    select: (state: { addTab: typeof addTab }) => unknown,
  ) => select({ addTab }),
}));

import { useCreateDraftPrompt } from "../useCreateDraftPrompt";

describe("useCreateDraftPrompt", () => {
  beforeEach(() => {
    addTab.mockReset();
    fetchResolvedDefault.mockReset();
    resolvedDefaultQuery.data = undefined;
  });

  describe("given the configured default model has not loaded yet", () => {
    describe("when the user creates their first prompt", () => {
      /** @scenario A first prompt created before the configured default loads uses it */
      it("fetches the configured default and uses it for the new prompt", async () => {
        fetchResolvedDefault.mockResolvedValue({
          model: "anthropic/claude-sonnet-5",
        });
        const { result } = renderHook(() => useCreateDraftPrompt());

        const { defaultValues } = await result.current.createDraftPrompt();

        expect(fetchResolvedDefault).toHaveBeenCalledWith({
          projectId: "project-1",
          featureKey: "prompt.create_default",
        });
        expect(defaultValues.version.configData.llm.model).toBe(
          "anthropic/claude-sonnet-5",
        );
      });
    });
  });

  describe("given the configured default model has loaded", () => {
    describe("when the user creates a prompt", () => {
      it("uses the loaded default without fetching again", async () => {
        resolvedDefaultQuery.data = { model: "anthropic/claude-opus-5-5" };
        const { result } = renderHook(() => useCreateDraftPrompt());

        const { defaultValues } = await result.current.createDraftPrompt();

        expect(fetchResolvedDefault).not.toHaveBeenCalled();
        expect(defaultValues.version.configData.llm.model).toBe(
          "anthropic/claude-opus-5-5",
        );
      });
    });
  });
});
