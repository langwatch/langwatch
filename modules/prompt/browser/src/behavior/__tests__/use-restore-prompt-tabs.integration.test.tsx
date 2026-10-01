/**
 * @vitest-environment jsdom
 */

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearStoreInstances, getStoreForTesting } from "../prompt-tabs-store.ts";
import { useRestorePromptTabs } from "../use-restore-prompt-tabs.ts";

const { fetchPrompt, failed } = vi.hoisted(() => ({ fetchPrompt: vi.fn(), failed: vi.fn() }));

vi.mock("../use-prompt-project.ts", () => ({
  usePromptProject: () => ({ project: { id: "project_1" }, projectId: "project_1" }),
}));
vi.mock("@langwatch/prompt-client", () => ({
  promptClient: { useUtils: () => ({ prompts: { getByIdOrHandle: { fetch: fetchPrompt } } }) },
}));
vi.mock("../../model/prompt-form/index.ts", () => ({
  computeInitialFormValuesForPrompt: () => ({ configId: "prompt-1", handle: "greeter" }),
}));

const entries = new Map<string, string>();
const capabilities = {
  storage: {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
};

vi.mock("../../model/prompt-host.ts", () => ({
  usePromptHost: () => ({ tabCapabilities: () => capabilities, failed }),
}));

function Restorer() {
  useRestorePromptTabs();
  return null;
}

/** A layout kept by an earlier page load: one tab, holding only its prompt id. */
function keepOneTab() {
  capabilities.storage.setItem(
    "project_1:draggable-tabs-browser-store",
    JSON.stringify({
      state: {
        windows: [
          {
            id: "window-1",
            activeTabId: "tab-1",
            tabs: [{ id: "tab-1", configId: "prompt-1", title: "greeter", versionNumber: 3 }],
          },
        ],
        activeWindowId: "window-1",
      },
      version: 0,
    }),
  );
  clearStoreInstances();
  return getStoreForTesting({ projectId: "project_1", capabilities });
}

describe("given a prompt tab kept across a reload", () => {
  beforeEach(() => {
    fetchPrompt.mockReset();
    failed.mockReset();
  });

  describe("when its prompt still exists", () => {
    /** @scenario Prompt tabs keep their layout and prompt ids, never their contents */
    it("reads the prompt at the kept version and fills the tab", async () => {
      fetchPrompt.mockResolvedValue({ version: 3 });
      const store = keepOneTab();

      render(<Restorer />);

      await waitFor(() => expect(store.getState().getByTabId("tab-1")?.loading).toBe(false));
      expect(fetchPrompt).toHaveBeenCalledWith({
        idOrHandle: "prompt-1",
        projectId: "project_1",
        version: 3,
      });
      expect(store.getState().getByTabId("tab-1")?.form.currentValues).toMatchObject({
        handle: "greeter",
      });
    });
  });

  describe("when its prompt is gone", () => {
    it("closes the tab", async () => {
      fetchPrompt.mockResolvedValue(null);
      const store = keepOneTab();

      render(<Restorer />);

      await waitFor(() => expect(store.getState().windows).toEqual([]));
      expect(failed).not.toHaveBeenCalled();
    });
  });
});
