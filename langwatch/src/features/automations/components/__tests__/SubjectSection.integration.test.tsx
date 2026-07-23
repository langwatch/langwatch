/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_DRAFT } from "../../logic/draftReducer";
import { useAutomationStore } from "../../state/automationStore";
import { SubjectSection } from "../SubjectSection";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", name: "Proj", slug: "proj" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    graphs: {
      getAll: {
        useQuery: () => ({
          data: [{ id: "graph-1", name: "Latency", trigger: null }],
          isLoading: false,
        }),
      },
      getById: {
        useQuery: () => ({
          data: {
            id: "graph-1",
            name: "Latency",
            graph: {
              series: [
                { name: "p95 latency", key: "latency", aggregation: "p95" },
              ],
            },
          },
          isLoading: false,
        }),
      },
    },
    dashboards: {
      getAll: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    useContext: () => ({}),
  },
}));

// Heavy popover/virtualizer surface; the graph path under test never renders it.
vi.mock("~/components/filters/FieldsFilters", () => ({
  FieldsFilters: () => <div data-testid="fields-filters" />,
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function selectContainingOption(optionName: RegExp): HTMLSelectElement {
  const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
  const match = selects.find((select) =>
    within(select)
      .queryAllByRole("option")
      .some((option) => optionName.test(option.textContent ?? "")),
  );
  if (!match) throw new Error(`No select with option ${String(optionName)}`);
  return match;
}

const seedGraphDraft = () =>
  useAutomationStore.getState().hydrate({
    ...INITIAL_DRAFT,
    source: "customGraph",
    customGraphId: "graph-1",
  });

describe("SubjectSection", () => {
  beforeEach(() => {
    useAutomationStore.getState().reset();
  });
  afterEach(() => {
    cleanup();
  });

  describe("given an alert draft", () => {
    it("renders the graph and series pickers", () => {
      seedGraphDraft();
      render(<SubjectSection />, { wrapper: Wrapper });

      expect(selectContainingOption(/select a graph/i)).toBeInTheDocument();
      expect(selectContainingOption(/select a series/i)).toBeInTheDocument();
    });

    describe("when opened prefilled from a graph card", () => {
      it("locks the graph select to the launching graph", () => {
        seedGraphDraft();
        render(<SubjectSection prefilledGraphId="graph-1" />, {
          wrapper: Wrapper,
        });

        expect(selectContainingOption(/select a graph/i)).toBeDisabled();
      });

      it("keeps the series select enabled", () => {
        seedGraphDraft();
        render(<SubjectSection prefilledGraphId="graph-1" />, {
          wrapper: Wrapper,
        });

        expect(selectContainingOption(/select a series/i)).toBeEnabled();
      });
    });

    describe("when a series is chosen", () => {
      it("records it on the draft", async () => {
        const user = userEvent.setup();
        seedGraphDraft();
        render(<SubjectSection />, { wrapper: Wrapper });

        await user.selectOptions(
          selectContainingOption(/select a series/i),
          "p95 latency",
        );

        expect(
          useAutomationStore.getState().draft.graphAlert.seriesName.length,
        ).toBeGreaterThan(0);
      });
    });
  });
});
