/**
 * @vitest-environment jsdom
 */

import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PromptBrowserStorage } from "../../../model/browser-capabilities.ts";
import { clearStoreInstances, getStoreForTesting } from "../behavior/prompt-tabs-store.ts";
import { useUrlParamToOpenNewTab } from "../behavior/use-url-param-to-open-new-tab.ts";

vi.mock("../../../behavior/use-prompt-project.ts", () => ({
  usePromptProject: () => ({ project: { id: "project_1" }, projectId: "project_1" }),
}));

const { mockGetResolvedDefault, fetchPrompt, query } = vi.hoisted(() => ({
  mockGetResolvedDefault: vi.fn(),
  fetchPrompt: vi.fn(),
  query: { value: {} as Record<string, string> },
}));

vi.mock("../../../behavior/prompt-api.ts", () => ({
  promptApi: {
    modelProvider: {
      getResolvedDefault: { useQuery: mockGetResolvedDefault },
    },
    useUtils: () => ({
      prompts: { getByIdOrHandle: { fetch: vi.fn() } },
    }),
  },
}));
const utils = { prompts: { getByIdOrHandle: { fetch: fetchPrompt } } };
vi.mock("@langwatch/prompt-client", () => ({
  promptClient: { useUtils: () => utils },
}));
vi.mock("../../../model/prompt-form/index.ts", () => ({
  computeInitialFormValuesForPrompt: () => ({ configId: "prompt-1", handle: "greeter" }),
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

vi.mock("../../../model/prompt-host.ts", () => ({
  usePromptHost: () => ({
    tabCapabilities: () => capabilities,
    route: () => ({ query: query.value }),
  }),
}));

const { renderCount } = vi.hoisted(() => ({ renderCount: { value: 0 } }));

function TestComponent() {
  useUrlParamToOpenNewTab();
  renderCount.value += 1;
  return null;
}

describe("useUrlParamToOpenNewTab", () => {
  beforeEach(() => {
    renderCount.value = 0;
    query.value = {};
    fetchPrompt.mockReset();
    clearStoreInstances();
    capabilities.storage = memoryStorage();
    mockGetResolvedDefault.mockReturnValue({ data: { model: "openai/gpt-5-mini" } });
  });

  describe("when the hook reads the tab store", () => {
    /** @scenario "Opening a prompt from the URL does not put the studio in a render loop" */
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

  describe("given a link carrying ?promptId= of a saved prompt", () => {
    /** @scenario A promptId link opens that prompt in a new tab */
    it("reads the prompt and opens it in exactly one tab", async () => {
      query.value = { promptId: "prompt-1" };
      fetchPrompt.mockResolvedValue({ id: "prompt-1", version: 2 });
      const store = getStoreForTesting({ projectId: "project_1", capabilities });

      const { rerender } = render(<TestComponent />);
      mockGetResolvedDefault.mockReturnValue({ data: { model: "openai/gpt-5" } });
      rerender(<TestComponent />);

      await waitFor(() => expect(store.getState().windows.flatMap((w) => w.tabs)).toHaveLength(1));
      expect(fetchPrompt).toHaveBeenCalledTimes(1);
      expect(fetchPrompt).toHaveBeenCalledWith({ idOrHandle: "prompt-1", projectId: "project_1" });
      expect(store.getState().windows[0]?.tabs[0]?.data.meta.title).toBe("greeter");
    });
  });

  describe("given a reload of a ?promptId= link whose prompt already has a tab", () => {
    /** @scenario "Reloading a promptId link focuses the tab already holding that prompt" */
    it("focuses that tab and opens no second one", async () => {
      query.value = { promptId: "prompt-1" };
      fetchPrompt.mockResolvedValue({ id: "prompt-1", version: 2 });
      const store = getStoreForTesting({ projectId: "project_1", capabilities });
      const tabData = (configId: string) => ({
        chat: { initialMessagesFromSpanData: [] },
        form: { currentValues: { configId } },
        meta: { title: configId },
        variableValues: {},
      });
      const greeterTabId = store.getState().addTab({ data: tabData("prompt-1") });
      const otherTabId = store.getState().addTab({ data: tabData("prompt-2") });
      expect(store.getState().isTabIdActive(otherTabId)).toBe(true);

      render(<TestComponent />);

      await waitFor(() => expect(store.getState().isTabIdActive(greeterTabId)).toBe(true));
      expect(store.getState().windows.flatMap((w) => w.tabs)).toHaveLength(2);
    });
  });
});
