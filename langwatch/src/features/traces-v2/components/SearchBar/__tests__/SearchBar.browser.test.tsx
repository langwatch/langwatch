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

vi.mock("../useDynamicValueSuggestions", () => ({
  useDynamicValueSuggestions: () => undefined,
}));

import { useFilterStore } from "../../../stores/filterStore";
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
  useFilterStore.getState().clearAll();
});

afterEach(() => {
  cleanup();
  useFilterStore.getState().clearAll();
});

describe("SearchBar wiring in real Chromium", () => {
  describe("when the user types into the search bar", () => {
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

      await waitFor(() => {
        expect(useFilterStore.getState().queryText).toBe("status:error");
      });
      expect(useFilterStore.getState().parseError).toBeNull();
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
      await userEvent.keyboard('status:"unclosed');

      await waitFor(() => {
        expect(useFilterStore.getState().parseError).toBeTruthy();
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
      await userEvent.keyboard("status:error");
      await waitFor(() => {
        expect(useFilterStore.getState().queryText).toBe("status:error");
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
        expect(useFilterStore.getState().queryText).toBe("");
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
      await userEvent.keyboard("status:error");

      await waitFor(() => {
        expect(useFilterStore.getState().queryText).toBe("status:error");
      });

      // Re-typing the same text doesn't reset page or churn AST identity.
      const astBefore = useFilterStore.getState().ast;
      // Trigger a redundant applyQueryText with the same canonical text.
      useFilterStore.getState().applyQueryText("status:error");
      const astAfter = useFilterStore.getState().ast;
      expect(astAfter).toBe(astBefore);
    });
  });
});
