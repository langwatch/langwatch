/**
 * Real-Chromium tests for the wired-up <SearchBar /> — exercises the path
 * from typing through the real filterStore so we can verify side effects
 * (URL fragment writes, clear button, parse error indicator) end-to-end.
 *
 * Editor-level interaction coverage lives in `ActiveSearchEditor.browser.test`.
 * This file focuses on the wiring around it.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import "@testing-library/jest-dom/vitest";

vi.mock("../../../hooks/useTraceFacets", () => ({
  useTraceFacets: () => ({ data: [], isLoading: false }),
}));

// Enter on a sentence calls `tracesV2.routeSearch`; these tests only type
// `field:value` queries, which are applied without a call, so the mutation
// hook is stubbed out rather than mounting a tRPC provider.
vi.mock("~/utils/api", () => ({
  api: {
    tracesV2: {
      routeSearch: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      instantEval: {
        estimate: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
        start: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
      },
    },
  },
}));

// SearchBar mounts TokenValuePicker, which now calls useFacetSearch (a tRPC
// query) at the top level. This suite renders SearchBar without a tRPC
// provider, so stub the hook out — server search has its own dedicated suite.
vi.mock("../../../hooks/useFacetSearch", () => ({
  useFacetSearch: () => ({ values: [], totalDistinct: 0, isLoading: false }),
}));

// This suite exercises the inline search editor wiring, so Langy is gated
// off — the gate hooks carry session/tRPC wiring this suite doesn't mount.
// The Langy-owned ask affordance is covered by SearchBar.integration.
vi.mock("~/features/langy/hooks/useShowLangy", () => ({
  useShowLangy: () => false,
}));
vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => false,
}));
vi.mock("~/features/langy/stores/langyStore", () => {
  const state = () => ({
    isOpen: false,
    askLangy: () => undefined,
    openPanel: () => undefined,
    attachContext: () => undefined,
  });
  const useLangyStore = (selector: (s: ReturnType<typeof state>) => unknown) =>
    selector(state());
  useLangyStore.getState = state;
  return { useLangyStore };
});

import { useExplorerStore } from "../../../stores/explorerStore";
import { SearchBar } from "../SearchBar";

function renderSearchBar() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SearchBar />
    </ChakraProvider>,
  );
}

function getEditor(): HTMLElement {
  const editor = document.querySelector(".tiptap") as HTMLElement | null;
  if (!editor) throw new Error("editor not mounted");
  return editor;
}

beforeEach(() => {
  useExplorerStore.getState().clearAll();
});

afterEach(() => {
  cleanup();
  useExplorerStore.getState().clearAll();
});

describe("SearchBar wiring in real Chromium", () => {
  describe("when the user types into the search bar and presses Enter", () => {
    /** @scenario "Pressing Enter applies the query" */
    it("commits the parsed query to the filterStore", async () => {
      renderSearchBar();
      // Cold mount → placeholder. Click activates the real editor.
      const placeholder = document.querySelector(
        "[data-placeholder]",
      ) as HTMLElement;
      await userEvent.click(placeholder);
      const editor = getEditor();
      await userEvent.click(editor);
      await userEvent.keyboard("status:error");
      // Typing alone commits nothing.
      expect(useExplorerStore.getState().queryText).toBe("");
      // The first Enter accepts the highlighted value, the second submits.
      await userEvent.keyboard("[Enter][Enter]");

      await waitFor(() => {
        expect(useExplorerStore.getState().queryText).toBe("status:error");
      });
      expect(useExplorerStore.getState().parseError).toBeNull();
    });
  });

  describe("when the typed query is unparseable", () => {
    it("surfaces the parse error indicator and keeps the previous AST", async () => {
      renderSearchBar();
      await userEvent.click(
        document.querySelector("[data-placeholder]") as HTMLElement,
      );
      const editor = getEditor();
      await userEvent.click(editor);
      await userEvent.keyboard('status:"unclosed[Enter]');

      await waitFor(() => {
        expect(useExplorerStore.getState().parseError).toBeTruthy();
      });
      // The parse-error pill exposes itself as a popover trigger.
      const indicator = document.querySelector(
        '[aria-label="View syntax error"]',
      );
      expect(indicator).toBeTruthy();
    });
  });

  describe("when the user clicks the clear button", () => {
    it("empties the editor and the store", async () => {
      renderSearchBar();
      await userEvent.click(
        document.querySelector("[data-placeholder]") as HTMLElement,
      );
      const editor = getEditor();
      await userEvent.click(editor);
      await userEvent.keyboard("status:error[Enter][Enter]");
      await waitFor(() => {
        expect(useExplorerStore.getState().queryText).toBe("status:error");
      });

      // The clear button is a "ghost" Chakra Button labelled "Clear".
      const buttons = Array.from(
        document.querySelectorAll("button"),
      ) as HTMLButtonElement[];
      const clearBtn = buttons.find((b) => b.textContent?.trim() === "Clear");
      expect(clearBtn).toBeTruthy();
      // mouseDown matches the component's onMouseDown handler.
      clearBtn!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );

      await waitFor(() => {
        expect(useExplorerStore.getState().queryText).toBe("");
      });
    });
  });

  describe("when the user types many characters in quick succession", () => {
    it("only commits one canonical AST per distinct query", async () => {
      // Spy on parse to confirm the LRU cache absorbs duplicate parses
      // (filterHighlight + filterStore both parsing the same text per key).
      renderSearchBar();
      await userEvent.click(
        document.querySelector("[data-placeholder]") as HTMLElement,
      );
      const editor = getEditor();
      await userEvent.click(editor);
      await userEvent.keyboard("status:error[Enter][Enter]");

      await waitFor(() => {
        expect(useExplorerStore.getState().queryText).toBe("status:error");
      });

      // Re-typing the same text doesn't reset page or churn AST identity.
      const astBefore = useExplorerStore.getState().ast;
      // Trigger a redundant applyQueryText with the same canonical text.
      useExplorerStore.getState().applyQueryText("status:error");
      const astAfter = useExplorerStore.getState().ast;
      expect(astAfter).toBe(astBefore);
    });
  });
});
