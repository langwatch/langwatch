/**
 * @vitest-environment jsdom
 *
 * `useCreateDraftPrompt` used to select `{ addTab }` as a fresh object built
 * inside the selector, which `useSyncExternalStore` reads as a change on
 * every store read and re-renders the caller forever (the render loop fixed
 * for `PublishedPromptsList`, see
 * `screens/prompt-studio/sidebar/__tests__/published-prompts-list.integration.test.tsx`).
 * This renders the hook against the real tab store so the loop would fail
 * here rather than in an error boundary in the browser.
 */

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptBrowserStorage } from "../../model/browser-capabilities";
import { clearStoreInstances, getStoreForTesting } from "../../model/prompt-tabs-store";
import { useCreateDraftPrompt } from "../use-create-draft-prompt";

vi.mock("../use-prompt-project", () => ({
  usePromptProject: () => ({ project: { id: "project_1" }, projectId: "project_1" }),
}));

const { mockGetAllForProjectForFrontend, mockGetResolvedDefault } = vi.hoisted(() => ({
  mockGetAllForProjectForFrontend: vi.fn(),
  mockGetResolvedDefault: vi.fn(),
}));

vi.mock("../prompt-api", () => ({
  promptApi: {
    modelProvider: {
      getAllForProjectForFrontend: { useQuery: mockGetAllForProjectForFrontend },
      getResolvedDefault: { useQuery: mockGetResolvedDefault },
    },
  },
}));

function memoryStorage(): PromptBrowserStorage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

const capabilities = {
  storage: memoryStorage(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
};

vi.mock("../../model/prompt-host", () => ({
  usePromptHost: () => ({ tabCapabilities: () => capabilities }),
}));

const { renderCount } = vi.hoisted(() => ({ renderCount: { value: 0 } }));

function TestComponent() {
  useCreateDraftPrompt();
  renderCount.value += 1;
  return null;
}

describe("useCreateDraftPrompt", () => {
  beforeEach(() => {
    renderCount.value = 0;
    clearStoreInstances();
    mockGetAllForProjectForFrontend.mockReturnValue({ data: undefined, isLoading: false });
    mockGetResolvedDefault.mockReturnValue({ data: { model: "openai/gpt-5-mini" } });
  });

  describe("when the hook reads the tab store", () => {
    /** @scenario "Creating a draft prompt does not put the studio in a render loop" */
    it("renders once and stays put when an unrelated tab opens", () => {
      render(<TestComponent />);

      expect(renderCount.value).toBe(1);

      act(() => {
        getStoreForTesting({ projectId: "project_1", capabilities })
          .getState()
          .addTab({
            data: {
              chat: { initialMessagesFromSpanData: [] },
              form: { currentValues: {} },
              meta: { title: null },
              variableValues: {},
            },
          });
      });

      expect(renderCount.value).toBe(1);
    });
  });
});
