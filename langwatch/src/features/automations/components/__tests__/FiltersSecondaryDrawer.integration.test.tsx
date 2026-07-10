/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INITIAL_GRAPH_ALERT_DRAFT } from "../../logic/draftReducer";
import { FiltersSecondaryDrawer } from "../secondaries/FiltersSecondaryDrawer";

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
    useContext: () => ({}),
  },
}));

// Heavy popover/virtualizer surface with its own tRPC queries; the graph-alert
// path under test never renders it.
vi.mock("~/components/filters/FieldsFilters", () => ({
  FieldsFilters: () => <div data-testid="fields-filters" />,
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** Locates a native select by one of its option labels — the Field labels
 *  aren't programmatically wired to the NativeSelect fields. */
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

const renderDrawer = (
  props: Partial<Parameters<typeof FiltersSecondaryDrawer>[0]> = {},
) =>
  render(
    <FiltersSecondaryDrawer
      open
      source="customGraph"
      filters={{}}
      customGraphId="graph-1"
      graphAlert={INITIAL_GRAPH_ALERT_DRAFT}
      alertType={null}
      projectId="project-1"
      onSave={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />,
    { wrapper: Wrapper },
  );

describe("FiltersSecondaryDrawer", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given the drawer opens prefilled from a graph card", () => {
    it("locks the graph select to the launching graph", () => {
      renderDrawer({ prefilledGraphId: "graph-1" });

      expect(selectContainingOption(/select a graph/i)).toBeDisabled();
    });

    it("keeps the series select enabled so the default is not a cage", () => {
      renderDrawer({
        prefilledGraphId: "graph-1",
        prefilledSeriesName: "0/latency/p95",
      });

      expect(selectContainingOption(/select a series/i)).toBeEnabled();
    });

    describe("when no series is selected yet", () => {
      it("disables Done until a series is picked", () => {
        renderDrawer({ prefilledGraphId: "graph-1" });

        expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
      });
    });
  });
});
