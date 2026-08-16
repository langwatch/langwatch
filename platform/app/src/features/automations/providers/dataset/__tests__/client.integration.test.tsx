/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refetchMock, openDrawerMock, goBackMock, keepDraftMock } = vi.hoisted(
  () => ({
    refetchMock: vi.fn(),
    openDrawerMock: vi.fn(),
    goBackMock: vi.fn(),
    keepDraftMock: vi.fn(),
  }),
);

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

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: openDrawerMock, goBack: goBackMock }),
}));

vi.mock("../../../state/subFlow", () => ({
  keepDraftForSubFlow: keepDraftMock,
}));

const { default: client } = await import("../client");

const ConfigForm = client.ConfigForm;

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderForm = ({
  onChange = vi.fn(),
  datasetId = "",
}: { onChange?: ReturnType<typeof vi.fn>; datasetId?: string } = {}) => {
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

/** The props the section hands the dataset drawer when it navigates. */
const datasetDrawerProps = () => {
  const [drawer, props] = openDrawerMock.mock.calls.at(-1) as [
    string,
    {
      onSuccess: (created: {
        datasetId: string;
        name: string;
        columnTypes: { name: string; type: string }[];
      }) => void;
      onClose: () => void;
    },
  ];
  expect(drawer).toBe("addOrEditDataset");
  return props;
};

const chooseCreate = async () => {
  await userEvent.click(screen.getByRole("button", { name: /create new/i }));
  return datasetDrawerProps();
};

describe("dataset automation configuration", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given the project has no dataset yet", () => {
    /** @scenario "Creating a dataset from the automation is offered and works" */
    it("navigates to the dataset drawer and keeps the automation draft", async () => {
      renderForm();

      await chooseCreate();

      // The push unmounts this drawer, so the draft has to be spared the
      // reset a real close performs.
      expect(keepDraftMock).toHaveBeenCalled();
      expect(openDrawerMock).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Creating a dataset from the automation is offered and works" */
    it("selects the created dataset with a derived mapping and returns", async () => {
      const onChange = renderForm();

      const props = await chooseCreate();
      props.onSuccess({
        datasetId: "dataset-1",
        name: "Support traces",
        columnTypes: [
          { name: "trace_id", type: "string" },
          { name: "output", type: "string" },
        ],
      });
      props.onClose();

      expect(refetchMock).toHaveBeenCalled();
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
      expect(goBackMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the automation already points at a dataset", () => {
    /** @scenario "Leaving the dataset drawer without creating keeps the dataset already chosen" */
    it("puts the earlier dataset back when nothing was created", async () => {
      const onChange = renderForm({ datasetId: "dataset-existing" });

      const props = await chooseCreate();
      props.onClose();

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ datasetId: "dataset-existing" }),
      );
      expect(goBackMock).toHaveBeenCalledTimes(1);
    });

    it("leaves the created dataset in place instead of restoring", async () => {
      const onChange = renderForm({ datasetId: "dataset-existing" });

      const props = await chooseCreate();
      props.onSuccess({
        datasetId: "dataset-new",
        name: "New",
        columnTypes: [{ name: "input", type: "string" }],
      });
      props.onClose();

      // The picker clears its selection on the way out, so the earlier id
      // appears only if the close path wrongly restores it.
      const datasetIds = onChange.mock.calls.map(
        (call) => (call[0] as { datasetId: string }).datasetId,
      );
      expect(datasetIds.at(-1)).toBe("dataset-new");
      expect(datasetIds).not.toContain("dataset-existing");
    });
  });
});
