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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// The ask affordance belongs to Langy when Langy is available (spec:
// specs/traces-v2/search.feature). The gate hooks carry session/tRPC wiring
// these smoke tests don't mount, so both read one fixture flag; the store is
// a selector fixture so the handoff's calls can be asserted directly.
const langyMock = {
  enabled: false,
  panelOpen: false,
  ask: vi.fn(),
  open: vi.fn(),
  attach: vi.fn(),
  draft: "",
};
vi.mock("~/features/langy/hooks/useShowLangy", () => ({
  useShowLangy: () => langyMock.enabled,
}));
vi.mock("~/features/langy/hooks/useCanAskLangy", () => ({
  useCanAskLangy: () => langyMock.enabled,
}));
vi.mock("~/features/langy/stores/langyStore", () => {
  const state = () => ({
    isOpen: langyMock.panelOpen,
    askLangy: langyMock.ask,
    openPanel: langyMock.open,
    attachContext: langyMock.attach,
    // The handoff seeds the composer through the store, so the mock has to
    // carry a real draft: `seedDraft` reads it to decide whether the reader
    // already started writing.
    draft: langyMock.draft,
    setDraft: (text: string) => {
      langyMock.draft = text;
    },
  });
  const useLangyStore = (
    selector: (s: ReturnType<typeof state>) => unknown,
  ) => selector(state());
  useLangyStore.getState = state;
  return { useLangyStore };
});

// SearchBar pulls in tRPC via useOrganizationTeamProject + useModelProvidersSettings
// (used by the global AI shortcut). These tests don't wrap with withTRPC, so
// stub them out to keep the smoke render free of provider boilerplate.
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: undefined,
    organization: undefined,
    team: undefined,
    isFetching: false,
  }),
}));

vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({
    modelProviders: [],
    customDefaultModel: null,
    isLoading: false,
  }),
}));

vi.mock("../../../hooks/useTraceFacets", () => ({
  useTraceFacets: () => ({ data: [], isLoading: false }),
}));

// SearchBar mounts TokenValuePicker, which now calls useFacetSearch at the
// top level. These smoke tests don't wrap with a tRPC provider, so stub the
// hook out — its server search is covered by
// TokenValuePicker.serverSearch.integration.test.tsx.
vi.mock("../../../hooks/useFacetSearch", () => ({
  useFacetSearch: () => ({ values: [], totalDistinct: 0, isLoading: false }),
}));

// @paper-design/shaders-react requires WebGL, which jsdom does not provide.
// The shader backdrop is decorative; rendering nothing keeps the SearchBar
// mountable without crashing on an unhandled WebGL constructor rejection.
vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

import { useFilterStore } from "../../../stores/filterStore";
import { SearchBar } from "../SearchBar";

afterEach(() => {
  cleanup();
  useFilterStore.getState().clearAll();
});

beforeEach(() => {
  useFilterStore.getState().clearAll();
  langyMock.enabled = false;
  langyMock.panelOpen = false;
  langyMock.ask.mockClear();
  langyMock.open.mockClear();
  langyMock.attach.mockClear();
  langyMock.draft = "";
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

describe("<SearchBar /> ask affordance", () => {
  describe("given Langy is not available", () => {
    it("keeps the inline Ask AI affordance", () => {
      renderSearchBar();

      expect(screen.getByText("Ask AI")).toBeInTheDocument();
      expect(screen.queryByText("Ask Langy")).not.toBeInTheDocument();
    });

    it("keeps the Ask AI placeholder wording", () => {
      renderSearchBar();

      const placeholder = document.querySelector(
        "[data-placeholder]",
      ) as HTMLElement;
      expect(placeholder.dataset.placeholder).toContain("Ask AI");
    });
  });

  describe("given Langy is available", () => {
    beforeEach(() => {
      langyMock.enabled = true;
    });

    it("labels the affordance Ask Langy", () => {
      renderSearchBar();

      expect(screen.getByText("Ask Langy")).toBeInTheDocument();
      expect(screen.queryByText("Ask AI")).not.toBeInTheDocument();
    });

    it("swaps the placeholder wording to Ask Langy", () => {
      renderSearchBar();

      const placeholder = document.querySelector(
        "[data-placeholder]",
      ) as HTMLElement;
      expect(placeholder.dataset.placeholder).toContain("Ask Langy");
    });

    describe("when Ask Langy is clicked with the panel closed", () => {
      it("floats the Langy ask bar over the search bar instead of opening the panel", () => {
        renderSearchBar();

        fireEvent.click(screen.getByRole("button", { name: "Ask Langy" }));

        // The floating bar's input takes over; the structured bar steps back.
        expect(screen.getByRole("textbox")).toBeInTheDocument();
        expect(
          document.querySelector("[data-placeholder]"),
        ).not.toBeInTheDocument();
        expect(langyMock.open).not.toHaveBeenCalled();
        expect(langyMock.ask).not.toHaveBeenCalled();
      });

      it("shows that the applied search will go with the question", () => {
        useFilterStore.getState().applyQueryText("@status:error");
        renderSearchBar();

        fireEvent.click(screen.getByRole("button", { name: "Ask Langy" }));

        expect(
          screen.getByText(/Goes with your question/),
        ).toBeInTheDocument();
      });
    });

    describe("when a question is typed into the floating bar and sent", () => {
      it("asks Langy the question with the applied search attached, and the bar dissolves", () => {
        useFilterStore.getState().applyQueryText("@status:error");
        const applied = useFilterStore.getState().queryText;
        renderSearchBar();
        fireEvent.click(screen.getByRole("button", { name: "Ask Langy" }));

        const input = screen.getByRole("textbox");
        fireEvent.change(input, {
          target: { value: "why are these failing?" },
        });
        fireEvent.keyDown(input, { key: "Enter" });

        expect(langyMock.ask).toHaveBeenCalledWith("why are these failing?");
        expect(langyMock.attach).toHaveBeenCalledWith({
          type: "filter",
          id: applied,
          label: `filtered: ${applied}`,
        });
      });

      it("sends nothing when the bar is dismissed with Escape", () => {
        renderSearchBar();
        fireEvent.click(screen.getByRole("button", { name: "Ask Langy" }));

        fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

        expect(langyMock.ask).not.toHaveBeenCalled();
        expect(langyMock.open).not.toHaveBeenCalled();
        expect(langyMock.attach).not.toHaveBeenCalled();
      });
    });

    describe("when Ask Langy is clicked with the panel already open", () => {
      beforeEach(() => {
        langyMock.panelOpen = true;
      });

      it("uses the open panel — the search attaches, no second composer floats", () => {
        useFilterStore.getState().applyQueryText("@status:error");
        const applied = useFilterStore.getState().queryText;
        renderSearchBar();

        fireEvent.click(screen.getByRole("button", { name: "Ask Langy" }));

        expect(langyMock.open).toHaveBeenCalled();
        expect(langyMock.attach).toHaveBeenCalledWith({
          type: "filter",
          id: applied,
          label: `filtered: ${applied}`,
        });
        // The structured search bar stays put — no floating composer.
        expect(
          document.querySelector("[data-placeholder]"),
        ).toBeInTheDocument();
      });

      it("seeds the composer with an opening for the question", () => {
        useFilterStore.getState().applyQueryText("@status:error");
        renderSearchBar();

        fireEvent.click(screen.getByRole("button", { name: "Ask Langy" }));

        expect(langyMock.draft).not.toBe("");
      });

      it("leaves a question the reader already started alone", () => {
        langyMock.draft = "why are these slow";
        useFilterStore.getState().applyQueryText("@status:error");
        renderSearchBar();

        fireEvent.click(screen.getByRole("button", { name: "Ask Langy" }));

        expect(langyMock.draft).toBe("why are these slow");
      });
    });
  });
});
