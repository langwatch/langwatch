/**
 * @vitest-environment jsdom
 *
 * The published prompts list, rendered against the real tab store.
 *
 * The store is read through `useSyncExternalStore`, which compares snapshots
 * by reference: a selector that builds a fresh object makes every read look
 * like a change and the studio re-renders until React gives up. This suite
 * renders the list against the store rather than a double, so the loop is a
 * failure here rather than an error boundary in the browser.
 *
 * @see specs/prompts/prompt-studio-page.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PromptBrowserStorage } from "../../../../model/browser-capabilities";
import { clearStoreInstances, getStoreForTesting } from "../../../../model/prompt-tabs-store";
import { PublishedPromptsList } from "../published-prompts-list";

const { renderCount } = vi.hoisted(() => ({ renderCount: { value: 0 } }));

vi.mock("../published-prompt-content", () => ({
  PublishedPromptContent: ({ promptHandle }: { promptHandle: string | null }) => {
    renderCount.value += 1;
    return <span>{promptHandle}</span>;
  },
}));

vi.mock("../../../../behavior/use-prompt-project", () => ({
  usePromptProject: () => ({ project: { id: "project_1" }, projectId: "project_1" }),
}));

const { mockGetAllPrompts, mockGetResolvedDefault } = vi.hoisted(() => ({
  mockGetAllPrompts: vi.fn(),
  mockGetResolvedDefault: vi.fn(),
}));

vi.mock("../../../../behavior/prompt-api", () => ({
  promptApi: {
    prompts: { getAllPromptsForProject: { useQuery: mockGetAllPrompts } },
    modelProvider: { getResolvedDefault: { useQuery: mockGetResolvedDefault } },
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

vi.mock("../../../../model/prompt-host", () => ({
  usePromptHost: () => ({ tabCapabilities: () => capabilities }),
}));

describe("PublishedPromptsList", () => {
  beforeEach(() => {
    renderCount.value = 0;
    clearStoreInstances();
    mockGetResolvedDefault.mockReturnValue({ data: { model: "openai/gpt-5-mini" } });
    mockGetAllPrompts.mockReturnValue({
      data: [{ id: "prompt_1", handle: "greeting", version: 1, model: "openai/gpt-5-mini" }],
      isLoading: false,
    });
  });

  describe("when the list reads the tab store", () => {
    /** @scenario "The prompts sidebar lists published prompts without the studio failing" */
    it("renders each published prompt once and stays put when a tab opens", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <PublishedPromptsList />
        </ChakraProvider>,
      );

      expect(screen.getByText("greeting")).toBeInTheDocument();
      expect(renderCount.value).toBe(1);

      // The list reads one action off the store and nothing that a tab
      // changes, so a store update it does not select must not reach it.
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
