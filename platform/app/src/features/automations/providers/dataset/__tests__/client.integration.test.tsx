/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refetchMock, mutateMock, readHandledErrorMock, showErrorToastMock } =
  vi.hoisted(() => ({
    refetchMock: vi.fn(),
    mutateMock: vi.fn(),
    readHandledErrorMock: vi.fn(),
    showErrorToastMock: vi.fn(),
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
      upsert: {
        useMutation: () => ({ mutate: mutateMock, isPending: false }),
      },
    },
  },
}));

vi.mock("~/features/errors", () => ({
  readHandledError: readHandledErrorMock,
  describeError: () => "A dataset with this name already exists.",
  showErrorToast: showErrorToastMock,
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

const openCreateForm = async () => {
  await userEvent.click(screen.getByRole("button", { name: /create new/i }));
  return screen.getByPlaceholderText("New dataset name");
};

describe("dataset automation configuration", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given the project has no dataset yet", () => {
    /** @scenario "Creating a dataset from the automation is offered and works" */
    it("opens the inline creation form in the current drawer, never a second drawer", async () => {
      renderForm();

      expect(
        screen.queryByPlaceholderText("New dataset name"),
      ).not.toBeInTheDocument();

      await openCreateForm();

      expect(
        screen.getByPlaceholderText("New dataset name"),
      ).toBeInTheDocument();
      // Drawers are URL-routed singletons; the sub-flow must not mount one.
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    /** @scenario "Creating a dataset from the automation is offered and works" */
    it("creates the dataset and selects it with a derived column mapping", async () => {
      mutateMock.mockImplementation(
        (
          _input: unknown,
          callbacks: { onSuccess: (created: { id: string }) => void },
        ) => {
          callbacks.onSuccess({ id: "dataset-1" });
        },
      );
      const onChange = renderForm();

      const nameInput = await openCreateForm();
      await userEvent.type(nameInput, "Support traces");
      await userEvent.click(
        screen.getByRole("button", { name: /create dataset/i }),
      );

      expect(mutateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          name: "Support traces",
          columnTypes: expect.arrayContaining([
            expect.objectContaining({ name: "trace_id" }),
          ]),
        }),
        expect.anything(),
      );
      expect(refetchMock).toHaveBeenCalled();
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          datasetId: "dataset-1",
          mapping: expect.objectContaining({
            mapping: expect.objectContaining({
              trace_id: expect.objectContaining({ source: "trace_id" }),
              input: expect.objectContaining({ source: "input" }),
              output: expect.objectContaining({ source: "output" }),
            }),
          }),
        }),
      );
    });

    it("shows a taken name under the field instead of a toast", async () => {
      readHandledErrorMock.mockReturnValue({ code: "dataset_name_taken" });
      mutateMock.mockImplementation(
        (_input: unknown, callbacks: { onError: (error: unknown) => void }) => {
          callbacks.onError(new Error("dataset_name_taken"));
        },
      );
      renderForm();

      const nameInput = await openCreateForm();
      await userEvent.type(nameInput, "Support traces");
      await userEvent.click(
        screen.getByRole("button", { name: /create dataset/i }),
      );

      expect(
        screen.getByText("A dataset with this name already exists."),
      ).toBeInTheDocument();
      expect(showErrorToastMock).not.toHaveBeenCalled();
    });
  });
});
