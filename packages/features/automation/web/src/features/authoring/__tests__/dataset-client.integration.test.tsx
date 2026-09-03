/**
 * @vitest-environment jsdom
 *
 * WHAT THIS FILE LOST IN THE MOVE, said once so the gap is not mistaken for an
 * oversight. It used to be four scenarios about creating a dataset from inside
 * the automation drawer: navigating to the dataset drawer, announcing the
 * return leg, selecting what was created, and putting the previous dataset back
 * when nothing was. That whole sub-flow opened another feature's overlay
 * through the application's drawer registry, which a feature-web package may
 * not address, so it does not travel and neither do its tests. The
 * corresponding scenarios in
 * `specs/automations/authoring-drawer.feature` — "Creating a dataset from the
 * automation is offered and works", "Leaving the dataset drawer without
 * creating keeps the dataset already chosen" and "An abandoned sub-flow does
 * not seed the next automation" — are unbound until a cross-feature overlay
 * capability exists, and the two tests below are DELIBERATELY UNTAGGED rather
 * than bound to a scenario they do not prove. Recorded in
 * `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * What survives is what the provider still does, and it is the part that
 * decides whether an automation writes usable rows: picking a dataset derives
 * a full column mapping from that dataset's columns, and a saved row that has a
 * dataset but no mapping gets one backfilled once the list arrives.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refetchMock, datasets } = vi.hoisted(() => ({
  refetchMock: vi.fn(),
  datasets: {
    rows: [] as Array<{ id: string; name: string; columnTypes: unknown }>,
  },
}));

vi.mock("../../../behavior/automation-api", () => ({
  api: {
    dataset: {
      getAll: {
        useQuery: () => ({
          data: datasets.rows,
          isLoading: false,
          isError: false,
          refetch: refetchMock,
        }),
      },
    },
  },
}));

const { default: client } = await import("../ui/sections/dataset.client");

const ConfigForm = client.ConfigForm;

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const SUPPORT_TRACES = {
  id: "dataset-1",
  name: "Support traces",
  columnTypes: [
    { name: "trace_id", type: "string" },
    { name: "output", type: "string" },
  ],
};

const renderForm = ({
  onChange = vi.fn(),
  datasetId = "",
}: {
  onChange?: ReturnType<typeof vi.fn>;
  datasetId?: string;
} = {}) => {
  render(
    <ConfigForm
      slice={{ ...client.initialSlice(), datasetId }}
      onChange={onChange as never}
      ctx={{ projectId: "project-1" } as never}
    />,
    { wrapper: Wrapper },
  );
  return onChange;
};

describe("dataset automation configuration", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    datasets.rows = [];
  });

  describe("given the project has datasets", () => {
    it("derives a full column mapping from the chosen dataset", async () => {
      datasets.rows = [SUPPORT_TRACES];
      const onChange = renderForm();

      await userEvent.click(screen.getByRole("combobox"));
      // By role: the hidden native <option> Chakra keeps for form submission
      // carries the same text as the listbox row, and only one of the two is
      // the thing a person clicks.
      await userEvent.click(await screen.findByRole("option", { name: /Support traces/ }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          datasetId: "dataset-1",
          mapping: expect.objectContaining({
            mapping: expect.objectContaining({
              trace_id: expect.objectContaining({ source: "trace_id" }),
              output: expect.objectContaining({ source: "output" }),
            }),
          }),
        }),
      );
    });
  });

  describe("given a saved automation whose dataset has no mapping yet", () => {
    it("backfills the mapping once the dataset list arrives", async () => {
      datasets.rows = [SUPPORT_TRACES];
      const onChange = renderForm({ datasetId: "dataset-1" });

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({
            mapping: expect.objectContaining({
              mapping: expect.objectContaining({
                trace_id: expect.objectContaining({ source: "trace_id" }),
              }),
            }),
          }),
        );
      });
    });
  });
});
