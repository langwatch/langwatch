/**
 * The remembered scope across tabs: an open tab ignores another tab's write.
 * Spec: specs/navigation/remembered-scope-tabs.feature.
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  broadcastUiScopeWrite,
  UI_SELECTED_PROJECT_SLUG_KEY,
  useUiScopeMemory,
  writeUiScopeSelection,
} from "../ui-scope-storage";

const KEY = UI_SELECTED_PROJECT_SLUG_KEY;

/** The storage every tab shares, holding the given remembered project; one per test. */
function sharedStorage(projectSlug: string): Storage {
  const values = new Map<string, string>([[KEY, JSON.stringify(projectSlug)]]);
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

/** What the browser does in this tab when another tab writes the key. */
function anotherTabRemembers({ storage, slug }: { storage: Storage; slug: string }): void {
  storage.setItem(KEY, JSON.stringify(slug));
  window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
}

function mountReader(storage: Storage) {
  let renders = 0;
  const hook = renderHook(() => {
    renders += 1;
    return useUiScopeMemory(storage).selection.projectSlug;
  });
  return { hook, renders: () => renders };
}

describe("given a tab that read project X as the remembered scope", () => {
  describe("when another tab remembers project Y", () => {
    /** @scenario "A write in another tab leaves this tab's remembered scope alone" */
    it("still reads project X, does not render for it, and keeps X on a later render", () => {
      const storage = sharedStorage("project-x");
      const { hook, renders } = mountReader(storage);
      const before = renders();

      act(() => anotherTabRemembers({ storage, slug: "project-y" }));
      const rendersAfterWrite = renders();
      hook.rerender();

      expect(rendersAfterWrite).toBe(before);
      expect(hook.result.current).toBe("project-x");
    });
  });

  describe("when this tab remembers project Y", () => {
    /** @scenario "A write in this tab is still seen by its own readers" */
    it("reads project Y without a reload", () => {
      const storage = sharedStorage("project-x");
      const { hook } = mountReader(storage);

      act(() =>
        writeUiScopeSelection({
          writes: [{ key: "projectSlug", value: "project-y" }],
          storage,
          broadcast: broadcastUiScopeWrite,
        }),
      );

      expect(hook.result.current).toBe("project-y");
    });
  });
});

describe("given another tab last remembered project Y", () => {
  describe("when a new tab reads the remembered scope", () => {
    /** @scenario "A new tab opens on the last scope remembered" */
    it("reads project Y on its first read", () => {
      const { hook } = mountReader(sharedStorage("project-y"));

      expect(hook.result.current).toBe("project-y");
    });
  });
});
