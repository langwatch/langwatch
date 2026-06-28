/**
 * @vitest-environment jsdom
 *
 * Server-side facet value search. Typing in a categorical facet's value
 * search queries `tracesV2.facetValues` with a `prefix`, matching against ALL
 * distinct values — so a high-cardinality facet (models, users, services,
 * trace names, labels) can surface a value beyond the preloaded top-50.
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
import { Server } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// useFacetSearch (exercised for real here) reads project + time range and
// fires the tracesV2.facetValues query. Mock those three boundaries so the
// hook runs against a controllable server response.
const apiMock = vi.hoisted(() => ({ useQuery: vi.fn() }));

vi.mock("~/utils/api", () => ({
  api: { tracesV2: { facetValues: { useQuery: apiMock.useQuery } } },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("../../../stores/filterStore", () => ({
  useFilterStore: (selector: (s: unknown) => unknown) =>
    selector({ debouncedTimeRange: { from: 1, to: 2, label: undefined } }),
}));

import { FacetSection } from "../FacetSection";
import type { FacetItem, FacetValueState } from "../types";

// Five preloaded service values — the top-N the discover payload shipped.
// "finance-team-42" is deliberately NOT among them: it lives only server-side.
const PRELOADED: FacetItem[] = [
  { value: "checkout", label: "checkout", count: 50 },
  { value: "billing", label: "billing", count: 40 },
  { value: "auth", label: "auth", count: 30 },
  { value: "search", label: "search", count: 20 },
  { value: "inventory", label: "inventory", count: 10 },
];

const neutral = (): FacetValueState => "neutral";

function renderSection(props?: { supportsValueSearch?: boolean }) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <FacetSection
        title="SERVICE"
        icon={Server}
        field="service"
        items={PRELOADED}
        getValueState={neutral}
        onToggle={vi.fn()}
        onExclude={vi.fn()}
        supportsValueSearch={props?.supportsValueSearch}
      />
    </ChakraProvider>,
  );
}

const openSearchAndType = (text: string) => {
  fireEvent.click(
    screen.getByRole("button", { name: "Search SERVICE values" }),
  );
  const input = screen.getByPlaceholderText(/Search or press Enter/i);
  fireEvent.change(input, { target: { value: text } });
  return input as HTMLInputElement;
};

beforeEach(() => {
  apiMock.useQuery.mockReset();
  // Default: a settled, empty server response.
  apiMock.useQuery.mockImplementation(() => ({
    data: { values: [], totalDistinct: 0 },
    isLoading: false,
  }));
});

afterEach(() => cleanup());

describe("<FacetSection /> server-side value search", () => {
  describe("given a categorical facet that supports value search", () => {
    /** @scenario "Facet search matches against all values" */
    it("queries facetValues with a prefix and surfaces a value beyond the preloaded top-N", async () => {
      apiMock.useQuery.mockImplementation(
        (input: { prefix?: string }, opts: { enabled?: boolean }) => {
          if (!opts?.enabled) return { data: undefined, isLoading: false };
          const prefix = String(input.prefix ?? "").toLowerCase();
          if (prefix.includes("finance")) {
            return {
              data: {
                values: [{ value: "finance-team-42", count: 3 }],
                totalDistinct: 1,
              },
              isLoading: false,
            };
          }
          return { data: { values: [], totalDistinct: 0 }, isLoading: false };
        },
      );

      renderSection({ supportsValueSearch: true });
      openSearchAndType("finance");

      // The query reached past the preloaded five with a server-side prefix.
      expect(apiMock.useQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          facetKey: "service",
          prefix: expect.stringContaining("finance"),
        }),
        expect.objectContaining({ enabled: true }),
      );
      // And the server-only value renders as a row.
      expect(await screen.findByText("finance-team-42")).toBeInTheDocument();
    });
  });

  describe("given a facet that does NOT support value search (range/discrete)", () => {
    it("never enables the server query", () => {
      renderSection({ supportsValueSearch: false });
      openSearchAndType("finance");

      expect(apiMock.useQuery).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ enabled: true }),
      );
    });
  });

  describe("when the search is cleared", () => {
    it("restores the preloaded items and disables the server query", async () => {
      apiMock.useQuery.mockImplementation(
        (_input: { prefix?: string }, opts: { enabled?: boolean }) =>
          opts?.enabled
            ? {
                data: {
                  values: [{ value: "finance-team-42", count: 3 }],
                  totalDistinct: 1,
                },
                isLoading: false,
              }
            : { data: undefined, isLoading: false },
      );

      renderSection({ supportsValueSearch: true });
      const input = openSearchAndType("finance");
      expect(await screen.findByText("finance-team-42")).toBeInTheDocument();

      fireEvent.change(input, { target: { value: "" } });

      // The preloaded list is back; the server-only value is gone.
      await waitFor(() =>
        expect(screen.queryByText("finance-team-42")).not.toBeInTheDocument(),
      );
      expect(screen.getByText("checkout")).toBeInTheDocument();
      // The most recent facetValues call is disabled.
      const lastCall = apiMock.useQuery.mock.calls.at(-1);
      expect(lastCall?.[1]?.enabled).toBe(false);
    });
  });

  describe("while the server search is loading", () => {
    it("shows a spinner row", () => {
      apiMock.useQuery.mockImplementation(
        (_input: { prefix?: string }, opts: { enabled?: boolean }) =>
          opts?.enabled
            ? { data: undefined, isLoading: true }
            : { data: undefined, isLoading: false },
      );

      renderSection({ supportsValueSearch: true });
      openSearchAndType("finance");

      expect(screen.getByTestId("facet-search-spinner")).toBeInTheDocument();
    });
  });
});
