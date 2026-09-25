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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// The ask affordance belongs to Langy when Langy is available (spec:
// specs/traces-v2/search.feature). The gate hooks carry session/tRPC wiring
// these smoke tests don't mount, so both read one fixture flag; the store is
// a selector fixture so the handoff's calls can be asserted directly.
const langyMock = {
  enabled: false,
  panelOpen: false,
  // The composer draft the handoff seeds ("Find traces where ") — but never
  // over something already half-written, so the fixture carries the value.
  draft: "",
  ask: vi.fn(),
  open: vi.fn(),
  attach: vi.fn(),
  setDraft: vi.fn((draft: string) => {
    langyMock.draft = draft;
  }),
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
    // `seedDraft` reads `draft.trim()` before writing (ADR-058), so the
    // no-typed-text path throws on an undefined draft and never reaches
    // `attachContext`. The store really does carry both.
    draft: langyMock.draft,
    setDraft: langyMock.setDraft,
  });
  const useLangyStore = (selector: (s: ReturnType<typeof state>) => unknown) =>
    selector(state());
  useLangyStore.getState = state;
  return { useLangyStore };
});

// SearchBar pulls in tRPC via useOrganizationTeamProject + useModelProvidersSettings
// (used by the global AI shortcut). These tests don't wrap with withTRPC, so
// stub them out to keep the smoke render free of provider boilerplate.
//
// Mutable so the Instant Evals gate suite can give the SearchBar a project id
// (typedEvalRunOf needs one) without disturbing every other suite's default
// of no project.
const orgProjectMock: { project: { id: string } | undefined } = {
  project: undefined,
};
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: orgProjectMock.project,
    organization: { id: "org-1" },
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

// Enter on a sentence calls `tracesV2.routeSearch`; the hook's own routing
// is covered by useSubmitSearch.integration, so the mutation is stubbed
// here rather than mounting a tRPC provider.
//
// The estimate mutate and the feature-flag read are mutable so the Instant
// Evals gate suite can flip the flag result and assert on one shared spy —
// a fresh `vi.fn()` per render (the old shape) can never be asserted on.
const estimateMutate = vi.fn();
const routeSearchMutate = vi.fn();
const featureFlagMock: {
  data: { enabled: boolean } | undefined;
  isLoading: boolean;
} = { data: { enabled: true }, isLoading: false };
vi.mock("~/utils/api", () => ({
  api: {
    tracesV2: {
      routeSearch: {
        useMutation: () => ({ mutate: routeSearchMutate, isPending: false }),
      },
      instantEval: {
        estimate: {
          useMutation: () => ({ mutate: estimateMutate, isPending: false }),
        },
        start: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
      },
    },
    // The Instant Evals gate reads this flag; stub it enabled so these
    // smoke tests exercise the flag-on path unless a test overrides it.
    featureFlag: {
      isEnabled: {
        useQuery: () => ({
          data: featureFlagMock.data,
          isLoading: featureFlagMock.isLoading,
        }),
      },
    },
  },
}));

// @paper-design/shaders-react requires WebGL, which jsdom does not provide.
// The shader backdrop is decorative; rendering nothing keeps the SearchBar
// mountable without crashing on an unhandled WebGL constructor rejection.
vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

import { traceViewContextChip } from "~/features/langy/hooks/useLangyTraceViewContext";
import { useExplorerStore } from "../../../stores/explorerStore";
import { useSearchSubmitRequestStore } from "../../../stores/searchSubmitRequestStore";
import { SEARCH_BAR_PLACEHOLDER } from "../PlaceholderEditor";
import { SearchBar } from "../SearchBar";
import { SEARCH_HANDOFF_DRAFT } from "../searchLangyHandoff";

/** The view chip the handoff attaches, built the way the page builds it. */
function expectedViewChip(): { type: "filter"; id: string; label: string } {
  const view = useExplorerStore.getState();
  const filter = view;
  const lens = view.allLenses.find((l) => l.id === view.activeLensId);
  const chip = traceViewContextChip({
    queryText: filter.queryText,
    timeRange: filter.timeRange,
    lens: lens
      ? {
          id: view.activeLensId,
          name: lens.name,
          isSavedView: !lens.isBuiltIn,
          hasLocalChanges: view.draftState.has(view.activeLensId),
        }
      : undefined,
    grouping: view.grouping,
    sort: view.sort,
  });
  return { type: "filter", id: chip.ref ?? chip.id, label: chip.label };
}

afterEach(() => {
  cleanup();
  useExplorerStore.getState().clearAll();
});

beforeEach(() => {
  useExplorerStore.getState().clearAll();
  langyMock.enabled = false;
  langyMock.panelOpen = false;
  langyMock.draft = "";
  langyMock.ask.mockClear();
  langyMock.open.mockClear();
  langyMock.attach.mockClear();
  langyMock.setDraft.mockClear();
  orgProjectMock.project = undefined;
  estimateMutate.mockClear();
  routeSearchMutate.mockClear();
  featureFlagMock.data = { enabled: true };
  featureFlagMock.isLoading = false;
  useSearchSubmitRequestStore.getState().clear();
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
    /** @scenario "Search bar renders with placeholder text" */
    it("renders the placeholder, which invites a filter or a sentence", () => {
      renderSearchBar();

      const placeholder = document.querySelector(
        "[data-placeholder]",
      ) as HTMLElement;
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
      useExplorerStore.getState().applyQueryText("@status:error");
      renderSearchBar();

      const placeholder = document.querySelector(
        "[data-placeholder]",
      ) as HTMLElement;
      expect(placeholder.textContent).toContain("status:error");
    });

    it("shows the clear button", () => {
      useExplorerStore.getState().applyQueryText("@status:error");
      renderSearchBar();

      expect(screen.getByText(/clear/i)).toBeInTheDocument();
    });
  });

  describe("when the store has a parse error", () => {
    it("records the parse error in the store", () => {
      useExplorerStore.getState().applyQueryText('@status:"unclosed');
      renderSearchBar();

      expect(useExplorerStore.getState().parseError).not.toBeNull();
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

      const placeholder = document.querySelector(
        "[data-placeholder]",
      ) as HTMLElement;
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
      const placeholder = document.querySelector(
        "[data-placeholder]",
      ) as HTMLElement;
      expect(placeholder.dataset.placeholder).toBe(SEARCH_BAR_PLACEHOLDER);
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
        useExplorerStore.getState().applyQueryText("@status:error");
        renderSearchBar();

        fireEvent.click(screen.getByRole("button", { name: "Ask Langy" }));

        expect(screen.getByText(/Goes with your question/)).toBeInTheDocument();
      });
    });

    describe("when a question is typed into the floating bar and sent", () => {
      /** @scenario "Ask Langy sends the whole view with the question" */
      it("asks Langy the question with the view and the applied search attached, and the bar dissolves", () => {
        useExplorerStore.getState().applyQueryText("@status:error");
        const applied = useExplorerStore.getState().queryText;
        const viewChip = expectedViewChip();
        renderSearchBar();
        fireEvent.click(screen.getByRole("button", { name: "Ask Langy" }));

        const input = screen.getByRole("textbox");
        fireEvent.change(input, {
          target: { value: "why are these failing?" },
        });
        fireEvent.keyDown(input, { key: "Enter" });

        expect(langyMock.ask).toHaveBeenCalledWith("why are these failing?");
        // The view first (time range, lens, sort, the search), then the
        // filter chip the agent applies: at least what the passive page
        // context sends.
        expect(langyMock.attach).toHaveBeenNthCalledWith(1, viewChip);
        expect(viewChip.id).toContain("search and attribute filters:");
        expect(viewChip.id).toContain(applied);
        expect(langyMock.attach).toHaveBeenNthCalledWith(2, {
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
        useExplorerStore.getState().applyQueryText("@status:error");
        const applied = useExplorerStore.getState().queryText;
        renderSearchBar();

        fireEvent.click(screen.getByRole("button", { name: "Ask Langy" }));

        expect(langyMock.open).toHaveBeenCalled();
        // Nothing typed, so the composer opens with the sentence already
        // started — the handoff's seed, never over a half-written draft.
        expect(langyMock.setDraft).toHaveBeenCalledWith(SEARCH_HANDOFF_DRAFT);
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
    });
  });
});

// `isInstantEvalAvailable = instantEvalsReleased || instantEvalsFlagLoading`
// (SearchBar.tsx) is the gate every eval-chip submit runs through before it
// is allowed to reach the estimate. These tests drive a real submit through
// `useSearchSubmitRequestStore` — the same door a page button uses — since
// jsdom cannot type into TipTap (see the file banner). That store's request
// reaches `useSubmitSearch` the way Enter would, which reaches the real
// `useInstantEvalRoute` mounted inside `SearchBar`, so the wiring under test
// is the production wiring end to end, not a stub of it.
//
// Spec: specs/traces-v2/instant-eval-search.feature ("A refusal is a
// popover, never an error state").
describe("<SearchBar /> Instant Evals gate", () => {
  beforeEach(() => {
    orgProjectMock.project = { id: "project-1" };
  });

  describe("given the Instant Evals flag is off for the project", () => {
    beforeEach(() => {
      featureFlagMock.data = { enabled: false };
      featureFlagMock.isLoading = false;
    });

    /** @scenario "Instant Evals switched off open the contact-us popover and nothing is searched" */
    it("opens the contact-us popover and searches nothing", async () => {
      const typed = 'eval:"the user is annoyed"';
      // Seeds the store the way the bar shows a recognized chip while the
      // reader is still typing it, so the post-submit assertion can tell a
      // preserved value apart from an incidental empty default.
      useExplorerStore.getState().applyQueryText(typed);
      renderSearchBar();

      act(() => {
        useSearchSubmitRequestStore.getState().requestSubmit({ text: typed });
      });

      expect(
        await screen.findByTestId("instant-eval-refusal"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Instant Evals aren't enabled for this project yet"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Contact us" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Not now" }),
      ).toBeInTheDocument();
      expect(estimateMutate).not.toHaveBeenCalled();
      expect(routeSearchMutate).not.toHaveBeenCalled();
      // Nothing was applied over it: the chip stays exactly where the
      // reader left it, under the popover that explains why it did not run.
      expect(useExplorerStore.getState().queryText).toBe(typed);
    });
  });

  describe("given the Instant Evals flag read is still in flight", () => {
    beforeEach(() => {
      featureFlagMock.data = undefined;
      featureFlagMock.isLoading = true;
    });

    /** @scenario "A flag read still in flight lets the submit reach the estimate" */
    it("lets the submit reach the estimate and opens no popover", () => {
      renderSearchBar();

      act(() => {
        useSearchSubmitRequestStore
          .getState()
          .requestSubmit({ text: 'eval:"the user is annoyed"' });
      });

      expect(estimateMutate).toHaveBeenCalledTimes(1);
      expect(routeSearchMutate).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId("instant-eval-refusal"),
      ).not.toBeInTheDocument();
    });
  });
});
