// @vitest-environment jsdom

/**
 * The one sub-flow the authoring drawer runs: with no dataset to pick, the
 * section hands over and comes back. Both endings are exercised; the one
 * without a created dataset used to lose the automation's existing target.
 */

// See specs/automations/authoring-drawer.feature.
import { cleanup, screen } from "@testing-library/react";
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

const { fakeAutomationHost, renderWithAutomationHost } = await import("../../../testing");
const { isHandingOverToSubFlow, consumeDraftKeptOnSubFlowReturn } =
  await import("../behavior/sub-flow");
const { default: client } = await import("../ui/sections/dataset.client");

const ConfigForm = client.ConfigForm;

const renderSection = ({ datasetId = "" }: { datasetId?: string } = {}) => {
  const onChange = vi.fn();
  const host = fakeAutomationHost();
  renderWithAutomationHost(
    <ConfigForm
      slice={{ ...client.initialSlice(), datasetId }}
      onChange={onChange as never}
      ctx={{ projectId: "project-1" } as never}
    />,
    { host },
  );
  return { onChange, host };
};

const chooseToCreate = async () =>
  await userEvent.click(screen.getByRole("button", { name: /Create a new dataset/ }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  datasets.rows = [];
  // The sub-flow intents are module state, exactly so they survive the
  // drawer's unmount; clear them so one case cannot decide the next.
  consumeDraftKeptOnSubFlowReturn();
});

describe("creating a dataset from the automation", () => {
  describe("given the project has no dataset yet", () => {
    describe("when the user chooses to create one", () => {
      /** @scenario "Creating a dataset from the automation is offered and works" */
      it("opens the dataset drawer, takes what was created, and comes back with the draft", async () => {
        const { onChange, host } = renderSection();

        await chooseToCreate();

        const handover = host.recording.datasetHandovers[0];
        expect(handover, "the section did not hand over to the dataset drawer").toBeDefined();
        // The draft lives in a singleton store the drawer's unmount would wipe,
        // so the hand-over has to be announced before it happens.
        expect(isHandingOverToSubFlow()).toBe(true);

        handover!.created({
          datasetId: "dataset-9",
          columnTypes: [
            { name: "trace_id", type: "string" },
            { name: "output", type: "string" },
          ],
        });

        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({
            datasetId: "dataset-9",
            mapping: expect.objectContaining({
              mapping: expect.objectContaining({
                trace_id: expect.objectContaining({ source: "trace_id" }),
                output: expect.objectContaining({ source: "output" }),
              }),
            }),
          }),
        );
        expect(refetchMock).toHaveBeenCalled();

        handover!.returned();

        expect(consumeDraftKeptOnSubFlowReturn()).toBe(true);
      });
    });
  });

  describe("given the automation already points at a dataset", () => {
    describe("when the user closes the dataset drawer without creating one", () => {
      /** @scenario "Leaving the dataset drawer without creating keeps the dataset already chosen" */
      it("puts the dataset chosen before back, and comes back with the draft", async () => {
        const { onChange, host } = renderSection({ datasetId: "dataset-1" });

        await chooseToCreate();
        host.recording.datasetHandovers[0]!.returned();

        expect(onChange).toHaveBeenLastCalledWith(
          expect.objectContaining({ datasetId: "dataset-1" }),
        );
        expect(consumeDraftKeptOnSubFlowReturn()).toBe(true);
      });
    });
  });
});
