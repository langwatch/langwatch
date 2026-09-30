/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearStoreInstances } from "../../model/prompt-tabs-store.ts";
import { useCreateDraftPrompt } from "../use-create-draft-prompt.ts";

const { fetchResolvedDefault, resolvedDefaultQuery } = vi.hoisted(() => ({
  fetchResolvedDefault: vi.fn(),
  resolvedDefaultQuery: { data: undefined as { model: string } | null | undefined },
}));

vi.mock("../prompt-api.ts", () => ({
  promptApi: {
    useUtils: () => ({
      modelProvider: { getResolvedDefault: { fetch: fetchResolvedDefault } },
    }),
    modelProvider: {
      getAllForProjectForFrontend: { useQuery: () => ({ data: undefined, isLoading: false }) },
      getResolvedDefault: { useQuery: () => resolvedDefaultQuery },
    },
  },
}));
vi.mock("../use-prompt-project.ts", () => ({
  usePromptProject: () => ({ project: { id: "project-1" }, projectId: "project-1" }),
}));
vi.mock("../../model/prompt-host.ts", () => ({
  usePromptHost: () => ({
    tabCapabilities: () => ({
      storage: {
        length: 0,
        key: () => null,
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
  }),
}));

describe("useCreateDraftPrompt", () => {
  beforeEach(() => {
    clearStoreInstances();
    fetchResolvedDefault.mockReset();
    resolvedDefaultQuery.data = undefined;
  });

  describe("given the configured default model has not loaded yet", () => {
    describe("when the user creates their first prompt", () => {
      /** @scenario "A first prompt created before the configured default loads uses it" */
      it("fetches the configured default and uses it for the new prompt", async () => {
        fetchResolvedDefault.mockResolvedValue({ model: "anthropic/claude-sonnet-5" });
        const { result } = renderHook(() => useCreateDraftPrompt());

        const { defaultValues } = await result.current.createDraftPrompt();

        expect(fetchResolvedDefault).toHaveBeenCalledWith({
          projectId: "project-1",
          featureKey: "prompt.create_default",
        });
        expect(defaultValues.version.configData.llm.model).toBe("anthropic/claude-sonnet-5");
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
        expect(defaultValues.version.configData.llm.model).toBe("anthropic/claude-opus-5-5");
      });
    });
  });
});
