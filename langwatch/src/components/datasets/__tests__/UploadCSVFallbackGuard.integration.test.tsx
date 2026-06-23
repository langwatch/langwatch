/**
 * @vitest-environment jsdom
 *
 * P2#2 regression guard: on a no-storage install the direct upload throws
 * `DirectUploadUnavailableError` and the modal falls back to parsing the raw
 * file in-browser. A multi-GB file would OOM the tab there (the exact failure
 * direct upload avoids), so the fallback must FIRST guard on the legacy 25 MB
 * limit (`MAX_FILE_SIZE_BYTES`): over it, show a clear error and never parse.
 *
 * Integration test (renders the form, mocks the boundaries: the directUpload
 * service, the project/router/drawer hooks, and the tRPC name lookup). The
 * parse boundary is observed via `File.prototype.text` — the fallback parser's
 * first call — which must NOT fire for an oversize file.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { MAX_FILE_SIZE_BYTES } from "../../../server/datasets/upload-utils";

// Force the direct-upload request to report "no browser-reachable storage" so
// the modal takes the fallback path under test.
const requestDirectUpload = vi.fn();
const putFileToPresignedUrl = vi.fn();
const finalizeDirectUpload = vi.fn();
const abortPendingUpload = vi.fn();
vi.mock("../services/directUpload", async (importActual) => {
  const actual =
    await importActual<typeof import("../services/directUpload")>();
  return {
    ...actual,
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

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      dataset: {
        findNextName: { fetch: vi.fn().mockResolvedValue("New Dataset") },
      },
    }),
  },
}));

import {
  DirectUploadUnavailableError,
  PresignedUploadFailedError,
} from "../services/directUpload";
import { UploadCSVForm } from "../UploadCSVDrawer";

const renderForm = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <UploadCSVForm
        setUploadedDataset={vi.fn()}
        uploadedDataset={undefined}
        uploadCSVData={vi.fn()}
        enableDirectUpload={true}
      />
    </ChakraProvider>,
  );

beforeEach(() => {
  requestDirectUpload.mockReset();
  putFileToPresignedUrl.mockReset();
  finalizeDirectUpload.mockReset();
  abortPendingUpload.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UploadCSVForm 409-fallback size guard", () => {
  describe("when storage is unavailable and the file exceeds the legacy size limit", () => {
    it("does NOT parse the file and shows the too-large error", async () => {
      requestDirectUpload.mockRejectedValue(new DirectUploadUnavailableError());
      const user = userEvent.setup();

      renderForm();

      // An oversize file: report a size over the cap without allocating it.
      const oversize = new File(["x"], "big.csv", { type: "text/csv" });
      Object.defineProperty(oversize, "size", {
        value: MAX_FILE_SIZE_BYTES + 1,
      });
      // The fallback parser's first call is `file.text()` — spy to prove it
      // never parses an oversize file.
      const textSpy = vi
        .spyOn(oversize, "text")
        .mockResolvedValue("a,b\n1,2\n");

      const input = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      await user.upload(input, oversize);

      const uploadButton = screen.getByRole("button", { name: /upload/i });
      await user.click(uploadButton);

      await waitFor(() => {
        expect(screen.getByTestId("upload-error")).toHaveTextContent(
          /too large to upload on this deployment/i,
        );
      });
      // The whole point: the oversize file was never parsed in-browser.
      expect(textSpy).not.toHaveBeenCalled();
    });
  });

  describe("when storage is unavailable and the file is within the legacy size limit", () => {
    it("parses the file (fallback flow) instead of blocking", async () => {
      requestDirectUpload.mockRejectedValue(new DirectUploadUnavailableError());
      const uploadCSVData = vi.fn();
      const user = userEvent.setup();

      render(
        <ChakraProvider value={defaultSystem}>
          <UploadCSVForm
            setUploadedDataset={vi.fn()}
            uploadedDataset={undefined}
            uploadCSVData={uploadCSVData}
            enableDirectUpload={true}
          />
        </ChakraProvider>,
      );

      const smallFile = new File(["a,b\n1,2\n"], "small.csv", {
        type: "text/csv",
      });
      const textSpy = vi
        .spyOn(smallFile, "text")
        .mockResolvedValue("a,b\n1,2\n");

      const input = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      await user.upload(input, smallFile);

      const uploadButton = screen.getByRole("button", { name: /upload/i });
      await user.click(uploadButton);

      // Within the limit → the fallback parses and hands off to the drawer flow.
      await waitFor(() => {
        expect(textSpy).toHaveBeenCalled();
      });
      expect(screen.queryByTestId("upload-error")).not.toBeInTheDocument();
    });
  });

  describe("when the presigned PUT fails (CORS/network) and the file is small", () => {
    it("cleans up the pending upload and falls back to parsing instead of dead-ending", async () => {
      // Backend mints a presign, but the cross-origin PUT fails (e.g. no bucket
      // CORS rule). The modal must treat this like 'no storage' and fall back —
      // first reaping the orphaned `uploading` row.
      requestDirectUpload.mockResolvedValue({
        datasetId: "dataset_pending",
        slug: "s",
        uploadUrl: "https://s3.example/put",
        stagingKey: "staging/proj/u",
      });
      putFileToPresignedUrl.mockRejectedValue(new PresignedUploadFailedError());
      abortPendingUpload.mockResolvedValue(undefined);
      const uploadCSVData = vi.fn();
      const user = userEvent.setup();

      render(
        <ChakraProvider value={defaultSystem}>
          <UploadCSVForm
            setUploadedDataset={vi.fn()}
            uploadedDataset={undefined}
            uploadCSVData={uploadCSVData}
            enableDirectUpload={true}
          />
        </ChakraProvider>,
      );

      const smallFile = new File(["a,b\n1,2\n"], "small.csv", {
        type: "text/csv",
      });
      const textSpy = vi
        .spyOn(smallFile, "text")
        .mockResolvedValue("a,b\n1,2\n");

      const input = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      await user.upload(input, smallFile);
      await user.click(screen.getByRole("button", { name: /upload/i }));

      // Orphaned `uploading` row is cleaned up...
      await waitFor(() => {
        expect(abortPendingUpload).toHaveBeenCalledWith({
          projectId: "proj_1",
          datasetId: "dataset_pending",
        });
      });
      // ...and the small file falls back to the in-browser parse path.
      await waitFor(() => {
        expect(textSpy).toHaveBeenCalled();
      });
      expect(screen.queryByTestId("upload-error")).not.toBeInTheDocument();
    });
  });

  describe("when the presigned PUT fails (CORS/network) and the file exceeds the size limit", () => {
    it("shows the too-large error and does NOT parse the oversize file", async () => {
      requestDirectUpload.mockResolvedValue({
        datasetId: "dataset_pending",
        slug: "s",
        uploadUrl: "https://s3.example/put",
        stagingKey: "staging/proj/u",
      });
      putFileToPresignedUrl.mockRejectedValue(new PresignedUploadFailedError());
      abortPendingUpload.mockResolvedValue(undefined);
      const user = userEvent.setup();

      renderForm();

      const oversize = new File(["x"], "big.csv", { type: "text/csv" });
      Object.defineProperty(oversize, "size", {
        value: MAX_FILE_SIZE_BYTES + 1,
      });
      const textSpy = vi
        .spyOn(oversize, "text")
        .mockResolvedValue("a,b\n1,2\n");

      const input = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      await user.upload(input, oversize);
      await user.click(screen.getByRole("button", { name: /upload/i }));

      await waitFor(() => {
        expect(screen.getByTestId("upload-error")).toHaveTextContent(
          /too large to upload on this deployment/i,
        );
      });
      // The size-guard fires before any in-browser parse of the oversize file.
      expect(textSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the user cancels while the presign request is still in flight", () => {
    it("does NOT fall back or surface an error if the presign later rejects", async () => {
      // The cancel control aborts the AbortController, but requestDirectUpload is
      // not wired to it — so a no-storage install's DirectUploadUnavailableError
      // can still reject AFTER the cancel. The catch must recognise the cancel
      // (signal.aborted) and bail, NOT run the fallback parse / open the drawer.
      let rejectPresign!: (reason: unknown) => void;
      requestDirectUpload.mockReturnValue(
        new Promise((_resolve, reject) => {
          rejectPresign = reject;
        }),
      );
      const uploadCSVData = vi.fn();
      const user = userEvent.setup();

      render(
        <ChakraProvider value={defaultSystem}>
          <UploadCSVForm
            setUploadedDataset={vi.fn()}
            uploadedDataset={undefined}
            uploadCSVData={uploadCSVData}
            enableDirectUpload={true}
          />
        </ChakraProvider>,
      );

      const smallFile = new File(["a,b\n1,2\n"], "small.csv", {
        type: "text/csv",
      });
      // If the cancelled upload WRONGLY fell back, the parser would read the file.
      const textSpy = vi
        .spyOn(smallFile, "text")
        .mockResolvedValue("a,b\n1,2\n");

      const input = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      await user.upload(input, smallFile);
      await user.click(screen.getByRole("button", { name: /upload/i }));

      // Presign is in flight → the row shows a Cancel control. Cancel now.
      await waitFor(() => expect(requestDirectUpload).toHaveBeenCalledTimes(1));
      await user.click(
        await screen.findByRole("button", { name: /cancel upload/i }),
      );

      // The presign now rejects the way a no-storage install would — post-cancel.
      await act(async () => {
        rejectPresign(new DirectUploadUnavailableError());
        // Flush the rejection through handleUpload's catch.
        await Promise.resolve();
        await Promise.resolve();
      });

      // The cancel wins: no fallback parse, no drawer hand-off, no error banner.
      expect(textSpy).not.toHaveBeenCalled();
      expect(uploadCSVData).not.toHaveBeenCalled();
      expect(screen.queryByTestId("upload-error")).not.toBeInTheDocument();
    });
  });

  describe("when a same-origin local-FS PUT fails (e.g. storage not writable)", () => {
    it("surfaces the error, reaps the pending row, and does NOT fall back to parsing", async () => {
      // Local-FS upload: requestDirectUpload mints a SAME-ORIGIN staging URL + an
      // `uploading` row; the streaming PUT then fails with a real server error (a
      // plain Error, not PresignedUploadFailedError). The modal must surface it,
      // reap the pending row (else the slug is locked on retry), and NOT fall
      // back to the in-browser parse — the local route IS the upload mechanism.
      requestDirectUpload.mockResolvedValue({
        datasetId: "dataset_pending",
        slug: "s",
        uploadUrl: "/api/dataset/direct-upload/staging/up_1?projectId=proj_1",
        stagingKey: "staging/proj_1/up_1",
      });
      putFileToPresignedUrl.mockRejectedValue(
        new Error(
          'Dataset storage path "/var/lib/langwatch/objects" is not writable. Point LANGWATCH_LOCAL_STORAGE_PATH at a writable directory.',
        ),
      );
      abortPendingUpload.mockResolvedValue(undefined);
      const user = userEvent.setup();

      renderForm();

      // A SMALL file: if it WRONGLY fell back, the parser would run — so asserting
      // it never parses proves there was no fallback.
      const smallFile = new File(["a,b\n1,2\n"], "small.csv", {
        type: "text/csv",
      });
      const textSpy = vi
        .spyOn(smallFile, "text")
        .mockResolvedValue("a,b\n1,2\n");

      const input = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      await user.upload(input, smallFile);
      await user.click(screen.getByRole("button", { name: /upload/i }));

      // The actionable server error is surfaced verbatim...
      await waitFor(() => {
        expect(screen.getByTestId("upload-error")).toHaveTextContent(
          /LANGWATCH_LOCAL_STORAGE_PATH/,
        );
      });
      // ...the orphaned `uploading` row is reaped (slug free for retry)...
      expect(abortPendingUpload).toHaveBeenCalledWith({
        projectId: "proj_1",
        datasetId: "dataset_pending",
      });
      // ...and there was NO fallback parse, and no finalize after the failed PUT.
      expect(textSpy).not.toHaveBeenCalled();
      expect(finalizeDirectUpload).not.toHaveBeenCalled();
    });
  });
});
