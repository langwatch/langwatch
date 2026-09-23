/**
 * Smoke-level integration tests for the SearchBar.
 * @vitest-environment jsdom
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
};
vi.mock("../../../langy/hooks/use-show-langy.ts", () => ({
  useShowLangy: () => langyMock.enabled,
}));
vi.mock("../../../../../behavior/langy/use-can-ask-langy.ts", () => ({
  useCanAskLangy: () => langyMock.enabled,
}));
vi.mock("@langwatch/langy-browser-kit", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  // Only whether the panel is up: the ask itself leaves through the host.
  const state = () => ({ isOpen: langyMock.panelOpen });
  const useLangyStore = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state());
  useLangyStore.getState = state;
  return { ...actual, useLangyStore };
});

// SearchBar pulls in tRPC via useOrganizationTeamProject + useModelProvidersSettings
// (used by the global AI shortcut). These tests don't wrap with withTRPC, so
// stub them out to keep the smoke render free of provider boilerplate.
vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: undefined,
    organization: undefined,
    team: undefined,
    isFetching: false,
  }),
}));

vi.mock("../../../use-model-providers-settings.ts", () => ({
  useModelProvidersSettings: () => ({
    modelProviders: [],
    customDefaultModel: null,
    isLoading: false,
  }),
}));

vi.mock("../../hooks/use-trace-facets.ts", () => ({
  useTraceFacets: () => ({ data: [], isLoading: false }),
}));

// SearchBar mounts TokenValuePicker, which now calls useFacetSearch at the
// top level. These smoke tests don't wrap with a tRPC provider, so stub the
// hook out — its server search is covered by
// TokenValuePicker.serverSearch.integration.test.tsx.
vi.mock("../../hooks/use-facet-search.ts", () => ({
  useFacetSearch: () => ({ values: [], totalDistinct: 0, isLoading: false }),
}));

// The cost rule's estimate and start are tRPC mutations; these smoke tests
// mount no provider, and the rule itself is covered by
// use-instant-eval-route.integration.test.tsx.
vi.mock("../use-instant-eval-route.ts", () => ({
  useInstantEvalRoute: () => ({
    onInstantEvalRoute: vi.fn(),
    abandonPendingRun: vi.fn(),
    confirmation: null,
    confirmRun: vi.fn(),
    searchWordsInstead: vi.fn(),
    isEstimating: false,
    isStarting: false,
  }),
}));

// Enter on a sentence calls `traces.routeSearch`; the hook's own routing is
// covered by use-submit-search.integration, so the submit is stubbed here
// rather than mounting a tRPC provider.
vi.mock("../use-submit-search.ts", () => ({
  useSubmitSearch: () => ({ submitSearch: vi.fn(), isRouting: false }),
}));

// @paper-design/shaders-react requires WebGL, which jsdom does not provide.
// The shader backdrop is decorative; rendering nothing keeps the SearchBar
// mountable without crashing on an unhandled WebGL constructor rejection.
vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

import { useFilterStore } from "@langwatch/trace-browser-kit";

import {
  TraceHostApi,
  TraceHostProvider,
  type TraceLangyAskRequest,
} from "../../../../../behavior/trace-host.ts";
import { SEARCH_BAR_PLACEHOLDER } from "../placeholder-editor.tsx";
import { SearchBar } from "../search-bar.tsx";
import { SEARCH_HANDOFF_DRAFT } from "../search-langy-handoff.ts";

/** A host that remembers every question the bar handed to the agent. */
class AskingTraceHost extends TraceHostApi {
  readonly asked: TraceLangyAskRequest[] = [];

  project() {
    return { id: "project_1", slug: "demo", name: "Demo" };
  }
  organization() {
    return void 0;
  }
  team() {
    return void 0;
  }
  organizationRole() {
    return void 0;
  }
  currentUser() {
    return void 0;
  }
  hasPermission() {
    return true;
  }
  isLoading() {
    return false;
  }
  route() {
    return { params: {}, query: {}, pathname: "/demo/traces" };
  }
  setQuery() {}
  navigate() {}
  succeeded() {}
  failed() {}
  registerLangyActions(): () => void {
    return () => void 0;
  }
  askLangy(request: TraceLangyAskRequest): void {
    this.asked.push(request);
  }
}

let host = new AskingTraceHost();

afterEach(() => {
  cleanup();
  useFilterStore.getState().clearAll();
});

beforeEach(() => {
  useFilterStore.getState().clearAll();
  langyMock.enabled = false;
  langyMock.panelOpen = false;
  host = new AskingTraceHost();
});

function renderSearchBar() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TraceHostProvider value={host}>
        <SearchBar />
      </TraceHostProvider>
    </ChakraProvider>,
  );
}

describe("<SearchBar /> wiring smoke", () => {
  describe("when the component mounts with no active query", () => {
    /** @scenario "Search bar renders with placeholder text" */
    it("renders the placeholder, which invites a filter or a sentence", () => {
      renderSearchBar();

      const placeholder = document.querySelector("[data-placeholder]") as HTMLElement;
      expect(placeholder).toBeInTheDocument();
      expect(placeholder.dataset.placeholder).toBe(SEARCH_BAR_PLACEHOLDER);
      expect(placeholder.dataset.placeholder).toBe(
        "Search filters or type what you are looking for",
      );
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

      const placeholder = document.querySelector("[data-placeholder]") as HTMLElement;
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

    it("keeps the ask out of the placeholder: the button is the way to ask", () => {
      renderSearchBar();

      const placeholder = document.querySelector("[data-placeholder]") as HTMLElement;
      expect(placeholder.dataset.placeholder).not.toContain("Ask");
    });
  });

  describe("given Langy is available", () => {
    beforeEach(() => {
      langyMock.enabled = true;
    });

    /** @scenario "The ask button reads Ask Langy" */
    it("labels the affordance Ask Langy and keeps the placeholder the same", () => {
      renderSearchBar();

      expect(screen.getByText("Ask Langy")).toBeInTheDocument();
      expect(screen.queryByText("Ask AI")).not.toBeInTheDocument();
      const placeholder = document.querySelector("[data-placeholder]") as HTMLElement;
      expect(placeholder.dataset.placeholder).toBe(SEARCH_BAR_PLACEHOLDER);
    });

    describe("when Ask Langy is clicked with the panel closed", () => {
      it("floats the Langy ask bar over the search bar instead of opening the panel", () => {
        renderSearchBar();

        fireEvent.click(screen.getByRole("button", { name: "Ask Langy" }));

        // The floating bar's input takes over; the structured bar steps back.
        expect(screen.getByRole("textbox")).toBeInTheDocument();
        expect(document.querySelector("[data-placeholder]")).not.toBeInTheDocument();
        expect(host.asked).toEqual([]);
      });

      it("shows that the applied search will go with the question", () => {
        useFilterStore.getState().applyQueryText("@status:error");
        renderSearchBar();

        fireEvent.click(screen.getByRole("button", { name: "Ask Langy" }));

        expect(screen.getByText(/Goes with your question/)).toBeInTheDocument();
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

        expect(host.asked).toHaveLength(1);
        expect(host.asked[0]?.question).toBe("why are these failing?");
        expect(host.asked[0]?.context).toContainEqual({
          kind: "filter",
          ref: applied,
          label: `filtered: ${applied}`,
        });
      });

      it("sends nothing when the bar is dismissed with Escape", () => {
        renderSearchBar();
        fireEvent.click(screen.getByRole("button", { name: "Ask Langy" }));

        fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

        expect(host.asked).toEqual([]);
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

        // Nothing typed, so the composer opens with the sentence already
        // started — the handoff's seed, never over a half-written draft.
        expect(host.asked).toHaveLength(1);
        expect(host.asked[0]?.question).toBeUndefined();
        expect(host.asked[0]?.draft).toBe(SEARCH_HANDOFF_DRAFT);
        expect(host.asked[0]?.context).toContainEqual({
          kind: "filter",
          ref: applied,
          label: `filtered: ${applied}`,
        });
        // The structured search bar stays put — no floating composer.
        expect(document.querySelector("[data-placeholder]")).toBeInTheDocument();
      });
    });
  });
});
