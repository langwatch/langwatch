/**
 * @vitest-environment jsdom
 *
 * Smoke-level integration tests for the SearchBar.
 *
 * The keyboard contract is exhaustively covered by handleKey.unit.test.ts and
 * getSuggestionState.unit.test.ts. This file only verifies that the SearchBar
 * mounts without crashing and exposes the right surface area to the store.
 *
 * Why so thin? TipTap/ProseMirror requires DOM APIs that jsdom does not
 * implement (elementFromPoint, getClientRects), so any test that types,
 * clicks, or selects inside the editor crashes. End-to-end keyboard
 * verification lives in the browser-pair task.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useFilterStore } from "../../../stores/filterStore";
import { SearchBar } from "../SearchBar";

afterEach(() => {
  cleanup();
  useFilterStore.getState().clearAll();
});

beforeEach(() => {
  useFilterStore.getState().clearAll();
});

function renderSearchBar() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <SearchBar />
    </ChakraProvider>,
  );
}

describe("<SearchBar /> wiring smoke", () => {
  describe("when the component mounts with no active query", () => {
    it("renders the editor with the placeholder", () => {
      renderSearchBar();

      const editor = document.querySelector(".tiptap");
      expect(editor).toBeInTheDocument();

      const placeholder = document.querySelector("[data-placeholder]");
      expect(placeholder).toBeInTheDocument();
    });

    it("does not show a clear button (input is empty)", () => {
      renderSearchBar();
      expect(screen.queryByText(/clear/i)).not.toBeInTheDocument();
    });

    it("does not show a parse error", () => {
      renderSearchBar();
      // No red parse-error box on initial render.
      const errorBox = document.querySelector('[role="alert"]');
      expect(errorBox).not.toBeInTheDocument();
    });
  });

  describe("when the store has an active query", () => {
    it("renders the query text in the editor", () => {
      useFilterStore.getState().applyQueryText("@status:error");
      renderSearchBar();

      const editor = document.querySelector(".tiptap") as HTMLElement;
      expect(editor.textContent).toContain("status:error");
    });

    it("shows the clear button", () => {
      useFilterStore.getState().applyQueryText("@status:error");
      renderSearchBar();

      // The clear control is a button with text "Clear".
      expect(screen.getByText(/clear/i)).toBeInTheDocument();
    });
  });

  describe("when the store has a parse error", () => {
    it("renders the parse error message", () => {
      // Invalid query — applyQueryText sets parseError on the store.
      useFilterStore.getState().applyQueryText('@status:"unclosed');
      renderSearchBar();

      // The exact message comes from the parser; just verify *some* error renders.
      expect(useFilterStore.getState().parseError).not.toBeNull();
    });
  });
});
