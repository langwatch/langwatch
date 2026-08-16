/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refetchMock, drawerPropsSpy } = vi.hoisted(() => ({
  refetchMock: vi.fn(),
  drawerPropsSpy: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    dataset: {
      getAll: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          isError: false,
          refetch: refetchMock,
        }),
      },
    },
  },
}));

// The real drawer pulls tRPC mutations and the whole dataset form in. What the
// automation owns is the wiring: the picker's create affordance must open it,
// and a created dataset must land on the slice.
vi.mock("~/components/AddOrEditDatasetDrawer", () => ({
  AddOrEditDatasetDrawer: (props: {
    open?: boolean;
    onSuccess: (dataset: {
      datasetId: string;
      name: string;
      columnTypes: { name: string; type: string }[];
    }) => void;
  }) => {
    drawerPropsSpy(props);
    return props.open === true ? <div>new dataset drawer</div> : null;
  },
}));

const { default: client } = await import("../client");

const ConfigForm = client.ConfigForm;

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderForm = (onChange = vi.fn()) => {
  render(
    <ConfigForm
      slice={client.initialSlice()}
      onChange={onChange}
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
  });

  describe("given the project has no dataset yet", () => {
    /** @scenario "Creating a dataset from the automation is offered and works" */
    it("opens the dataset creation drawer from the picker", async () => {
      renderForm();

      expect(screen.queryByText("new dataset drawer")).not.toBeInTheDocument();

      await userEvent.click(
        screen.getByRole("button", { name: /create new/i }),
      );

      expect(screen.getByText("new dataset drawer")).toBeInTheDocument();
    });

    /** @scenario "Creating a dataset from the automation is offered and works" */
    it("selects the created dataset and derives its column mapping", async () => {
      const onChange = renderForm();

      await userEvent.click(
        screen.getByRole("button", { name: /create new/i }),
      );

      const props = drawerPropsSpy.mock.calls.at(-1)?.[0] as {
        onSuccess: (dataset: {
          datasetId: string;
          name: string;
          columnTypes: { name: string; type: string }[];
        }) => void;
      };
      props.onSuccess({
        datasetId: "dataset-1",
        name: "Support traces",
        columnTypes: [
          { name: "input", type: "string" },
          { name: "output", type: "string" },
        ],
      });

      expect(refetchMock).toHaveBeenCalled();
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          datasetId: "dataset-1",
          mapping: expect.objectContaining({
            mapping: expect.objectContaining({
              input: expect.objectContaining({ source: "input" }),
              output: expect.objectContaining({ source: "output" }),
            }),
          }),
        }),
      );
    });
  });
});
