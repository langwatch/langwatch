/**
 * @vitest-environment jsdom
 *
 * Component tests for the Upload CSV drawer pieces: the redesigned dropzone
 * (empty state, drag highlight, file status row, collapse), the in-drawer
 * processing view, the cancel control, and error routing. Renders the
 * components and mocks the boundaries (upload service, tRPC, project/router
 * hooks). Binds specs/datasets/dataset-upload-dropzone.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Mutable result the mocked `dataset.getById.useQuery` returns, so each test
// drives DatasetUploadProcessing into a specific state.
const getByIdResult: {
  data: Record<string, unknown> | null | undefined;
  isFetched: boolean;
} = { data: undefined, isFetched: false };
const retryDatasetNormalize = vi.fn();
const requestDirectUpload = vi.fn();
const putFileToPresignedUrl = vi.fn();
const finalizeDirectUpload = vi.fn();
const abortPendingUpload = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      dataset: {
        findNextName: { fetch: vi.fn().mockResolvedValue("New Dataset") },
      },
    }),
    dataset: {
      getById: {
        useQuery: () => ({
          data: getByIdResult.data,
          isFetched: getByIdResult.isFetched,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock("../services/directUpload", async (importActual) => {
  const actual =
    await importActual<typeof import("../services/directUpload")>();
  return {
    ...actual,
    retryDatasetNormalize: (...args: unknown[]) =>
      retryDatasetNormalize(...args),
    requestDirectUpload: (...args: unknown[]) => requestDirectUpload(...args),
    putFileToPresignedUrl: (...args: unknown[]) =>
      putFileToPresignedUrl(...args),
    finalizeDirectUpload: (...args: unknown[]) => finalizeDirectUpload(...args),
    abortPendingUpload: (...args: unknown[]) => abortPendingUpload(...args),
  };
});

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "proj" },
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn() }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

import {
  CSVReaderComponent,
  DatasetUploadProcessing,
  UploadCSVForm,
} from "../UploadCSVDrawer";

/** Error shaped like an aborted fetch. */
const abortError = () =>
  Object.assign(new Error("aborted"), { name: "AbortError" });

const wrap = (ui: React.ReactElement) =>
  render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);

const fileInput = () =>
  document.querySelector('input[type="file"]') as HTMLInputElement;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  getByIdResult.data = undefined;
  getByIdResult.isFetched = false;
});

describe("the upload dropzone", () => {
  describe("when no file has been chosen", () => {
    /** @scenario The empty dropzone invites a file */
    it("invites a file with the prompt and supported types", () => {
      wrap(<CSVReaderComponent parse={false} onUploadAccepted={vi.fn()} />);

      expect(screen.getByText(/drag and drop file/i)).toBeInTheDocument();
      expect(screen.getByText(/click to browse/i)).toBeInTheDocument();
      expect(screen.getByText(/supported files/i)).toBeInTheDocument();
    });
  });

  describe("when a file is dragged over the zone", () => {
    /** @scenario Dragging a file over the dropzone highlights it */
    it("marks the zone active while the file is over it and clears on leave", () => {
      const { container } = wrap(
        <CSVReaderComponent parse={false} onUploadAccepted={vi.fn()} />,
      );
      const zone = container.querySelector("[data-active]") as HTMLElement;

      expect(zone).toHaveAttribute("data-active", "false");
      fireEvent.dragOver(zone);
      expect(zone).toHaveAttribute("data-active", "true");
      fireEvent.dragLeave(zone);
      expect(zone).toHaveAttribute("data-active", "false");
    });
  });

  describe("when a file is chosen", () => {
    /** @scenario A chosen file appears as a status row */
    it("shows a row with the file name and its size", async () => {
      const user = userEvent.setup();
      wrap(
        <CSVReaderComponent
          parse={false}
          onUploadAccepted={vi.fn()}
          onRawFile={vi.fn()}
        />,
      );

      await user.upload(
        fileInput(),
        new File(["a,b\n1,2\n"], "chosen.csv", { type: "text/csv" }),
      );

      expect(await screen.findByText("chosen.csv")).toBeInTheDocument();
      expect(screen.getByText(/\bB\b|KB|MB/)).toBeInTheDocument(); // size label
      expect(
        screen.getByRole("button", { name: /remove file/i }),
      ).toBeInTheDocument();
    });
  });

  describe("when the chosen file is removed", () => {
    /** @scenario Removing the chosen file returns the empty dropzone */
    it("drops the row and notifies removal", async () => {
      const user = userEvent.setup();
      const onUploadRemoved = vi.fn();
      wrap(
        <CSVReaderComponent
          parse={false}
          onUploadAccepted={vi.fn()}
          onRawFile={vi.fn()}
          onUploadRemoved={onUploadRemoved}
        />,
      );

      await user.upload(
        fileInput(),
        new File(["x"], "gone.csv", { type: "text/csv" }),
      );
      expect(await screen.findByText("gone.csv")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /remove file/i }));

      expect(screen.queryByText("gone.csv")).not.toBeInTheDocument();
      expect(onUploadRemoved).toHaveBeenCalledTimes(1);
      // The empty prompt is still mounted (it collapses, it doesn't unmount).
      expect(screen.getByText(/drag and drop file/i)).toBeInTheDocument();
    });
  });

  describe("when the chosen file breaks a limit", () => {
    /** @scenario A file that breaks a limit is rejected on its row */
    it("marks the file row with the error message", async () => {
      const user = userEvent.setup();
      const { rerender } = wrap(
        <CSVReaderComponent
          parse={false}
          onUploadAccepted={vi.fn()}
          onRawFile={vi.fn()}
        />,
      );

      await user.upload(
        fileInput(),
        new File(["x"], "big.csv", { type: "text/csv" }),
      );
      expect(await screen.findByText("big.csv")).toBeInTheDocument();

      // The host computes the validation and passes it down.
      rerender(
        <ChakraProvider value={defaultSystem}>
          <CSVReaderComponent
            parse={false}
            onUploadAccepted={vi.fn()}
            onRawFile={vi.fn()}
            fileError="File is too large"
          />
        </ChakraProvider>,
      );

      expect(screen.getByTestId("upload-error")).toHaveTextContent(
        /file is too large/i,
      );
    });
  });

  describe("when the file is uploading", () => {
    /** @scenario An uploading file shows progress and can be cancelled */
    it("shows the uploading row and a cancel control that fires onCancel", async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      const { rerender } = wrap(
        <CSVReaderComponent
          parse={false}
          onUploadAccepted={vi.fn()}
          onRawFile={vi.fn()}
          onCancel={onCancel}
        />,
      );

      await user.upload(
        fileInput(),
        new File(["x"], "uploading.csv", { type: "text/csv" }),
      );

      rerender(
        <ChakraProvider value={defaultSystem}>
          <CSVReaderComponent
            parse={false}
            onUploadAccepted={vi.fn()}
            onRawFile={vi.fn()}
            uploadStatus="uploading"
            onCancel={onCancel}
          />
        </ChakraProvider>,
      );

      const cancel = screen.getByRole("button", { name: /cancel upload/i });
      expect(cancel).toBeInTheDocument();
      // The trash remove control is replaced by cancel while uploading.
      expect(
        screen.queryByRole("button", { name: /remove file/i }),
      ).not.toBeInTheDocument();

      await user.click(cancel);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });
});

describe("DatasetUploadProcessing", () => {
  const renderProcessing = (overrides?: {
    onReady?: () => void;
    onViewDataset?: () => void;
  }) =>
    wrap(
      <DatasetUploadProcessing
        projectId="proj_1"
        datasetId="dataset_1"
        onReady={overrides?.onReady ?? vi.fn()}
        onViewDataset={overrides?.onViewDataset ?? vi.fn()}
      />,
    );

  describe("when the dataset is still processing", () => {
    it("shows the preparing state and does not call onReady", () => {
      getByIdResult.data = {
        id: "dataset_1",
        name: "ds",
        status: "processing",
      };
      getByIdResult.isFetched = true;
      const onReady = vi.fn();
      renderProcessing({ onReady });

      expect(screen.getByText(/preparing your dataset/i)).toBeInTheDocument();
      expect(onReady).not.toHaveBeenCalled();
    });
  });

  describe("when the dataset becomes ready", () => {
    /** @scenario A finished upload shows a ready row without leaving the drawer */
    it("shows the ready row with a View dataset action and calls onReady once", () => {
      getByIdResult.data = {
        id: "dataset_1",
        name: "ds",
        status: "ready",
        columnTypes: [{ name: "question", type: "string" }],
      };
      getByIdResult.isFetched = true;
      const onReady = vi.fn();
      const onViewDataset = vi.fn();
      const { rerender } = renderProcessing({ onReady, onViewDataset });

      expect(screen.getByText(/ready/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /view dataset/i }),
      ).toBeInTheDocument();
      expect(onReady).toHaveBeenCalledTimes(1);

      // A re-render with the same ready data must not fire onReady again.
      rerender(
        <ChakraProvider value={defaultSystem}>
          <DatasetUploadProcessing
            projectId="proj_1"
            datasetId="dataset_1"
            onReady={onReady}
            onViewDataset={onViewDataset}
          />
        </ChakraProvider>,
      );
      expect(onReady).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the dataset reports ready but has no columns yet", () => {
    it("keeps showing preparing (does not trust the schema-default ready)", () => {
      getByIdResult.data = {
        id: "dataset_1",
        name: "ds",
        status: "ready",
        columnTypes: [],
      };
      getByIdResult.isFetched = true;
      const onReady = vi.fn();
      renderProcessing({ onReady });

      expect(screen.getByText(/preparing your dataset/i)).toBeInTheDocument();
      expect(onReady).not.toHaveBeenCalled();
    });
  });

  describe("when the dataset failed to prepare", () => {
    it("shows the error message and a Retry action", () => {
      getByIdResult.data = {
        id: "dataset_1",
        name: "ds",
        status: "failed",
        statusError: "boom",
      };
      getByIdResult.isFetched = true;
      renderProcessing();

      expect(screen.getByText("boom")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /retry/i }),
      ).toBeInTheDocument();
    });
  });

  describe("when the dataset is gone", () => {
    it("shows a terminal not-available message instead of an endless spinner", () => {
      getByIdResult.data = null;
      getByIdResult.isFetched = true;
      const onReady = vi.fn();
      renderProcessing({ onReady });

      expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
      expect(
        screen.queryByText(/preparing your dataset/i),
      ).not.toBeInTheDocument();
      expect(onReady).not.toHaveBeenCalled();
    });
  });
});

describe("UploadCSVForm cancel", () => {
  describe("when cancel lands before requestDirectUpload resolves", () => {
    it("reaps the just-minted dataset row instead of stranding it", async () => {
      const user = userEvent.setup();
      // requestDirectUpload is held open so we can cancel mid-flight, then
      // resolve it AFTER the cancel — the server has minted the row by then.
      let resolveRequest!: (value: {
        datasetId: string;
        uploadUrl: string;
        slug: string;
        stagingKey: string;
      }) => void;
      requestDirectUpload.mockReturnValue(
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
      );
      // The PUT fails immediately because the cancel already aborted the signal.
      putFileToPresignedUrl.mockImplementation(
        (_url: string, _file: File, signal?: AbortSignal) => {
          if (signal?.aborted) return Promise.reject(abortError());
          return Promise.resolve();
        },
      );
      abortPendingUpload.mockResolvedValue(undefined);

      render(
        <ChakraProvider value={defaultSystem}>
          <UploadCSVForm
            setUploadedDataset={vi.fn()}
            uploadedDataset={undefined}
            uploadCSVData={vi.fn()}
            enableDirectUpload={true}
            onDirectUploadComplete={vi.fn()}
          />
        </ChakraProvider>,
      );

      await user.upload(
        fileInput(),
        new File(["x"], "racey.csv", { type: "text/csv" }),
      );
      await user.click(screen.getByRole("button", { name: /^upload$/i }));

      // Mid-flight: the cancel control is shown; click it before the presign
      // resolves (so handleCancelUpload sees no id yet → reaps nothing).
      await user.click(
        await screen.findByRole("button", { name: /cancel upload/i }),
      );
      expect(abortPendingUpload).not.toHaveBeenCalled();

      // Now the presign resolves: the row exists, the aborted PUT throws, and
      // the catch must reap the now-known id.
      resolveRequest({
        datasetId: "dataset_racey",
        uploadUrl: "https://s3.example/put",
        slug: "s",
        stagingKey: "staging/proj/u",
      });

      await waitFor(() => {
        expect(abortPendingUpload).toHaveBeenCalledWith({
          projectId: "proj_1",
          datasetId: "dataset_racey",
        });
      });
      // Reaped exactly once.
      expect(abortPendingUpload).toHaveBeenCalledTimes(1);
    });
  });
});
