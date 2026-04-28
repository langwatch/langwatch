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
 * verification lives in the browser-pair task. Cold mount goes through the
 * lightweight placeholder so jsdom-incompatible TipTap code never runs in
 * these tests.
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
    it("renders the placeholder", () => {
      renderSearchBar();

      const placeholder = document.querySelector("[data-placeholder]");
      expect(placeholder).toBeInTheDocument();
    });

    it("defers TipTap mount until interaction", () => {
      renderSearchBar();
      // Placeholder is in the DOM; the heavy ProseMirror editor is not.
      expect(document.querySelector(".tiptap")).not.toBeInTheDocument();
    });

    it("does not show a clear button (input is empty)", () => {
      renderSearchBar();
      expect(screen.queryByText(/clear/i)).not.toBeInTheDocument();
    });

    it("does not show a parse error", () => {
      renderSearchBar();
      const errorBox = document.querySelector('[role="alert"]');
      expect(errorBox).not.toBeInTheDocument();
    });
  });

  describe("when the store has an active query", () => {
    it("renders the query text inside the placeholder", () => {
      useFilterStore.getState().applyQueryText("@status:error");
      renderSearchBar();

      const placeholder = document.querySelector(
        "[data-placeholder]",
      ) as HTMLElement;
      expect(placeholder.textContent).toContain("status:error");
    });

    it("shows the clear button", () => {
      useFilterStore.getState().applyQueryText("@status:error");
      renderSearchBar();

      expect(screen.getByText(/clear/i)).toBeInTheDocument();
    });
  });

  describe("when the store has a parse error", () => {
    it("records the parse error in the store", () => {
      useFilterStore.getState().applyQueryText('@status:"unclosed');
      renderSearchBar();

      expect(useFilterStore.getState().parseError).not.toBeNull();
    });
  });
});
