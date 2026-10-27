/**
 * The remembered scope across tabs: an open tab ignores another tab's write.
 * Spec: specs/navigation/remembered-scope-tabs.feature.
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  rememberUiScopeSelection,
  UI_SELECTED_PROJECT_SLUG_KEY,
  useUiScopeMemory,
} from "../ui-scope-storage";

const KEY = UI_SELECTED_PROJECT_SLUG_KEY;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(KEY, JSON.stringify("project-x"));
});

/** What the browser does in this tab when another tab writes the key. */
function anotherTabRemembers(slug: string): void {
  window.localStorage.setItem(KEY, JSON.stringify(slug));
  window.dispatchEvent(new StorageEvent("storage", { key: KEY, storageArea: window.localStorage }));
}

function mountReader() {
  let renders = 0;
  const hook = renderHook(() => {
    renders += 1;
    return useUiScopeMemory().selection.projectSlug;
  });
  return { hook, renders: () => renders };
}

describe("given a tab that read project X as the remembered scope", () => {
  describe("when another tab remembers project Y", () => {
    /** @scenario "A write in another tab leaves this tab's remembered scope alone" */
    it("still reads project X and does not render again", () => {
      const { hook, renders } = mountReader();
      const before = renders();

      act(() => anotherTabRemembers("project-y"));

      expect(hook.result.current).toBe("project-x");
      expect(renders()).toBe(before);
    });
  });

  describe("when this tab remembers project Y", () => {
    /** @scenario "A write in this tab is still seen by its own readers" */
    it("reads project Y without a reload", () => {
      const { hook } = mountReader();

      act(() => rememberUiScopeSelection({ writes: [{ key: "projectSlug", value: "project-y" }] }));

      expect(hook.result.current).toBe("project-y");
    });
  });
});

describe("given another tab last remembered project Y", () => {
  describe("when a new tab reads the remembered scope", () => {
    /** @scenario "A new tab opens on the last scope remembered" */
    it("reads project Y", () => {
      window.localStorage.setItem(KEY, JSON.stringify("project-y"));

      const { hook } = mountReader();

      expect(hook.result.current).toBe("project-y");
    });
  });
});
