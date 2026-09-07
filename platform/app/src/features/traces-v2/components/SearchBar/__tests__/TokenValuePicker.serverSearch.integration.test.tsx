/**
 * @vitest-environment jsdom
 *
 * Server-side search inside the search-bar value picker. Once the user edits
 * a categorical chip's value the picker queries `tracesV2.facetValues` with a
 * `prefix`, so a value beyond the preloaded top-N can be found and picked.
 * See specs/traces-v2/search.feature, rule "Very high-cardinality facets".
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const apiMock = vi.hoisted(() => ({ useQuery: vi.fn() }));

vi.mock("~/utils/api", () => ({
  api: { tracesV2: { facetValues: { useQuery: apiMock.useQuery } } },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

// The picker resolves its field's categorical descriptor from useTraceFacets.
// Preloaded top values: "checkout" / "billing" (so a server-only value like
// "finance-prod-99" proves the search reached past the top-N), plus the
// namespaced "openai/gpt-4o-mini" — the server's ANCHORED prefix "gpt-4o"
// misses it, so it exercises the supplement (preloaded ∪ server) regression.
vi.mock("../../../hooks/useTraceFacets", () => ({
  useTraceFacets: () => ({
    data: [
      {
        kind: "categorical",
        key: "service",
        label: "Service",
        topValues: [
          { value: "checkout", count: 50 },
          { value: "billing", count: 40 },
          { value: "openai/gpt-4o-mini", count: 5 },
        ],
      },
    ],
    isLoading: false,
  }),
}));

vi.mock("../../../stores/filterStore", () => ({
  useFilterStore: (selector: (s: unknown) => unknown) =>
    selector({
      setFacetValueAt: vi.fn(),
      debouncedTimeRange: { from: 1, to: 2, label: undefined },
    }),
}));

vi.mock("../../../stores/uiStore", () => ({
  useUIStore: (selector: (s: unknown) => unknown) =>
    selector({ setSyntaxHelpOpen: vi.fn() }),
}));

import { TokenValuePicker } from "../TokenValuePicker";

const anchor = {
  rect: { bottom: 100, left: 100, top: 80, right: 220 } as DOMRect,
  field: "service",
  currentValue: "checkout",
  location: { start: 0, end: 16 },
};

beforeEach(() => {
  apiMock.useQuery.mockReset();
  apiMock.useQuery.mockImplementation(
    (input: { prefix?: string }, opts: { enabled?: boolean }) => {
      if (!opts?.enabled) return { data: undefined, isLoading: false };
      const prefix = String(input.prefix ?? "").toLowerCase();
      if (prefix.includes("finance")) {
        return {
          data: {
            values: [{ value: "finance-prod-99", count: 7 }],
            totalDistinct: 1,
          },
          isLoading: false,
        };
      }
      return { data: { values: [], totalDistinct: 0 }, isLoading: false };
    },
  );
});

afterEach(() => cleanup());

describe("<TokenValuePicker /> server-side search", () => {
  describe("given the user edits a categorical chip's value", () => {
    it("queries facetValues with a prefix and surfaces a value beyond the preloaded top-N", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <TokenValuePicker anchor={anchor} onClose={vi.fn()} />
        </ChakraProvider>,
      );

      // Prefilled with the chip's current value ("checkout") — pristine, no
      // server hit. Editing it to "finance" flips to a server-side search.
      const input = screen.getByPlaceholderText(/Filter service values/i);
      fireEvent.change(input, { target: { value: "finance" } });

      // The typed text is debounced before the server query fires, hence
      // waitFor rather than a synchronous assertion.
      await waitFor(() =>
        expect(apiMock.useQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            facetKey: "service",
            prefix: expect.stringContaining("finance"),
          }),
          expect.objectContaining({ enabled: true }),
        ),
      );
      expect(await screen.findByText("finance-prod-99")).toBeInTheDocument();
    });

    it("does not hit the server while the input still holds the unedited value", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <TokenValuePicker anchor={anchor} onClose={vi.fn()} />
        </ChakraProvider>,
      );

      // Pristine (input === currentValue) → every call stays disabled.
      expect(apiMock.useQuery).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ enabled: true }),
      );
    });
  });

  describe("given a substring match lives within a preloaded value", () => {
    // The server does a PREFIX match anchored at the start, so "gpt-4o" misses
    // the namespaced "openai/gpt-4o-mini" and returns nothing. A replace-regression
    // (the empty server result REPLACING the preloaded list) would drop the row;
    // the SUPPLEMENT contract unions preloaded + server and keeps the live client
    // substring filter, so the preloaded value — a substring match — stays shown.
    // Mirrors FacetSection.serverSearch's preloaded-survival regression.
    describe("when the user edits the chip to a value the server prefix-search misses", () => {
      /** @scenario "Editing a search-bar value chip searches all values, not just the preloaded set" */
      it("keeps a matching preloaded value when the server prefix search misses it (supplement, not replace)", async () => {
        apiMock.useQuery.mockImplementation(
          (_input: { prefix?: string }, opts: { enabled?: boolean }) =>
            opts?.enabled
              ? { data: { values: [], totalDistinct: 0 }, isLoading: false }
              : { data: undefined, isLoading: false },
        );

        render(
          <ChakraProvider value={defaultSystem}>
            <TokenValuePicker anchor={anchor} onClose={vi.fn()} />
          </ChakraProvider>,
        );

        const input = screen.getByPlaceholderText(/Filter service values/i);
        fireEvent.change(input, { target: { value: "gpt-4o" } });

        // Server search goes active (debounced) and prefix-misses → empty result…
        await waitFor(() =>
          expect(apiMock.useQuery).toHaveBeenCalledWith(
            expect.objectContaining({
              facetKey: "service",
              prefix: expect.stringContaining("gpt-4o"),
            }),
            expect.objectContaining({ enabled: true }),
          ),
        );
        // …yet the preloaded value, a substring match over the preloaded∪server
        // union, is still shown. Under a replace-regression it would vanish.
        expect(
          await screen.findByText("openai/gpt-4o-mini"),
        ).toBeInTheDocument();
      });
    });
  });
});
