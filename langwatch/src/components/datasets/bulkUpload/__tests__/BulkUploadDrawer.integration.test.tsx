/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Bulk upload drawer: render the drawer with the
 * directUpload service, the header parser, the per-row poller's tRPC query, and
 * the project/router hooks mocked. Asserts the user-visible behaviour of the
 * spec scenarios (rows, inline confirm, independent prep, failure/retry, cancel).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { DatasetConfirmColumns } from "~/server/datasets/types";

const requestDirectUpload = vi.fn();
const putFileToPresignedUrl = vi.fn();
const finalizeDirectUpload = vi.fn();
const abortPendingUpload = vi.fn();
const retryDatasetNormalize = vi.fn();
vi.mock("../../services/directUpload", async (orig) => {
  const actual = await orig<typeof import("../../services/directUpload")>();
  return {
    ...actual,
    requestDirectUpload: (...a: unknown[]) => requestDirectUpload(...a),
    putFileToPresignedUrl: (...a: unknown[]) => putFileToPresignedUrl(...a),
    finalizeDirectUpload: (...a: unknown[]) => finalizeDirectUpload(...a),
    abortPendingUpload: (...a: unknown[]) => abortPendingUpload(...a),
    retryDatasetNormalize: (...a: unknown[]) => retryDatasetNormalize(...a),
  };
});

const parseHeaderColumns = vi.fn();
vi.mock("../../utils/parseHeaderColumns", () => ({
  HEADER_PARSE_MAX_BYTES: 262144,
  parseHeaderColumns: (...a: unknown[]) => parseHeaderColumns(...a),
}));

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

// DatasetUploadProcessing (reused per row) polls dataset.getById — resolve ready.
const getByIdQuery = vi.fn(() => ({
  data: { id: "dataset_x", name: "n", status: "ready", columnTypes: [] },
  isFetched: true,
  refetch: vi.fn(),
}));
vi.mock("~/utils/api", () => ({
  api: {
    dataset: {
      getById: { useQuery: () => getByIdQuery() },
      // ADR-034: the drawer opens one lifted progress subscription; the test
      // drives no live events, so a no-op stub keeps the rows on their getById
      // status poll (which resolves ready above).
      onDatasetProgress: { useSubscription: () => undefined },
    },
    useContext: () => ({}),
  },
}));

import { BulkUploadDrawer } from "../BulkUploadDrawer";

// Faithful to what `parseHeaderColumns` actually returns: each column carries
// its immutable `sourceHeader` (the canonical header it was parsed from), which
// is the key the confirm UI binds rename/retype/reorder to — without it,
// `setBySource` would match every column at once.
const twoCols: DatasetConfirmColumns = [
  { name: "a", type: "string", sourceHeader: "a" },
  { name: "b", type: "string", sourceHeader: "b" },
];

const csv = (name: string) =>
  new File(["a,b\n1,2\n"], name, { type: "text/csv" });

const render_ = (onUploaded = vi.fn()) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <BulkUploadDrawer open onClose={vi.fn()} onUploaded={onUploaded} />
    </ChakraProvider>,
  );

const fileInput = () =>
  document.querySelector('input[type="file"]') as HTMLInputElement;

const uploadButton = () => screen.getByRole("button", { name: /upload all/i });

beforeEach(() => {
  requestDirectUpload.mockReset().mockResolvedValue({
    datasetId: "dataset_1",
    slug: "data",
    uploadUrl: "https://s3.example/put",
  });
  putFileToPresignedUrl.mockReset().mockResolvedValue(undefined);
  finalizeDirectUpload.mockReset().mockResolvedValue({ status: "processing" });
  abortPendingUpload.mockReset().mockResolvedValue(undefined);
  retryDatasetNormalize.mockReset().mockResolvedValue(undefined);
  parseHeaderColumns.mockReset().mockResolvedValue(twoCols);
});
afterEach(() => cleanup());

describe("given the bulk upload drawer", () => {
  describe("when several files are dropped", () => {
    /** @scenario Dropping several files lists one row per file */
    it("lists one row per file with its name and size, and enables upload", async () => {
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [
        csv("one.csv"),
        csv("two.csv"),
        csv("three.csv"),
      ]);

      await waitFor(() => {
        expect(screen.getByText("one")).toBeInTheDocument();
      });
      expect(screen.getByText("two")).toBeInTheDocument();
      expect(screen.getByText("three")).toBeInTheDocument();
      expect(uploadButton()).toBeEnabled();
    });
  });

  describe("when more files are added after the first drop", () => {
    /** @scenario Adding more files appends to the list */
    it("appends without replacing the earlier rows", async () => {
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [csv("one.csv"), csv("two.csv")]);
      await waitFor(() => expect(screen.getByText("one")).toBeInTheDocument());
      await user.upload(fileInput(), [csv("three.csv"), csv("four.csv")]);

      await waitFor(() => expect(screen.getByText("four")).toBeInTheDocument());
      expect(screen.getByText("one")).toBeInTheDocument();
      expect(screen.getByText("three")).toBeInTheDocument();
    });
  });

  describe("when the same file is dropped twice", () => {
    /** @scenario The same file dropped twice becomes two rows */
    it("creates two independently-named rows", async () => {
      const user = userEvent.setup();
      render_();
      const f = csv("dup.csv");
      await user.upload(fileInput(), [f]);
      await waitFor(() => expect(screen.getByText("dup")).toBeInTheDocument());
      await user.upload(fileInput(), [csv("dup.csv")]);

      // Two rows: "dup" and the deduped "dup (1)".
      await waitFor(() =>
        expect(screen.getByText("dup (1)")).toBeInTheDocument(),
      );
      expect(screen.getByText("dup")).toBeInTheDocument();
    });
  });

  describe("when a file is removed before uploading", () => {
    /** @scenario Removing a not-yet-started file drops only that row */
    it("drops only that row", async () => {
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [csv("keep.csv"), csv("drop.csv")]);
      await waitFor(() => expect(screen.getByText("drop")).toBeInTheDocument());

      // Two rows → two remove buttons in order; the second is the "drop" row.
      await user.click(screen.getAllByLabelText(/remove file/i)[1]!);

      await waitFor(() =>
        expect(screen.queryByText("drop")).not.toBeInTheDocument(),
      );
      expect(screen.getByText("keep")).toBeInTheDocument();
    });
  });

  describe("when the last file is removed", () => {
    /** @scenario Removing the last file disables the upload action */
    it("disables the upload action", async () => {
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [csv("only.csv")]);
      await waitFor(() => expect(screen.getByText("only")).toBeInTheDocument());

      await user.click(screen.getByLabelText(/remove file/i));
      await waitFor(() =>
        expect(screen.queryByText("only")).not.toBeInTheDocument(),
      );
      expect(uploadButton()).toBeDisabled();
    });
  });

  describe("when a file's columns are detected", () => {
    /** @scenario Each file's columns are detected and shown collapsed */
    /** @scenario Confirming columns never opens a separate drawer */
    it("shows a collapsed confirm with text defaults, editable in place", async () => {
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [csv("data.csv")]);
      await waitFor(() =>
        expect(
          screen.getByText(/2 columns — confirm types/i),
        ).toBeInTheDocument(),
      );

      // Collapsed: the column inputs are not rendered until expanded.
      expect(screen.queryByLabelText("Column 1 name")).not.toBeInTheDocument();
      await user.click(screen.getByText(/2 columns — confirm types/i));

      const nameInput = await screen.findByLabelText("Column 1 name");
      expect(nameInput).toHaveValue("a");
      // The type picker is the styled Select (icon + label), defaulting to text.
      expect(screen.getByLabelText("Column 1 type")).toHaveTextContent(
        /string/i,
      );
      // Editing happens in place — no separate dialog/drawer with a Save button.
      expect(
        screen.queryByRole("button", { name: /^save$/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when a file's name is edited", () => {
    it("renames the dataset in place and uploads under the new name", async () => {
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [csv("data.csv")]);
      await waitFor(() => expect(screen.getByText("data")).toBeInTheDocument());

      await user.click(screen.getByText("data"));
      const nameField = await screen.findByLabelText("Dataset name");
      await user.clear(nameField);
      await user.type(nameField, "renamed{Enter}");

      await waitFor(() =>
        expect(screen.getByText("renamed")).toBeInTheDocument(),
      );

      await user.click(uploadButton());
      await waitFor(() => expect(requestDirectUpload).toHaveBeenCalled());
      expect(requestDirectUpload.mock.calls[0]![0].name).toBe("renamed");
    });
  });

  describe("when files are uploaded", () => {
    /** @scenario Uploading prepares every file independently in the background */
    it("prepares every file and each becomes ready on its own", async () => {
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [csv("one.csv"), csv("two.csv")]);
      await waitFor(() => expect(screen.getByText("one")).toBeInTheDocument());

      await user.click(uploadButton());

      await waitFor(() =>
        expect(screen.getAllByText(/ready/i).length).toBeGreaterThanOrEqual(2),
      );
      expect(requestDirectUpload).toHaveBeenCalledTimes(2);
    });

    /** @scenario The types I confirmed are applied to that file's dataset */
    it("sends the confirmed column types for that file", async () => {
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [csv("data.csv")]);
      await waitFor(() =>
        expect(screen.getByText(/confirm types/i)).toBeInTheDocument(),
      );
      await user.click(screen.getByText(/confirm types/i));
      // Open the styled type Select and pick "Number" from the option list.
      await user.click(await screen.findByLabelText("Column 1 type"));
      await user.click(await screen.findByRole("option", { name: /number/i }));
      await user.click(uploadButton());

      await waitFor(() => expect(requestDirectUpload).toHaveBeenCalled());
      // Each column carries its immutable sourceHeader so normalize can bind by
      // header (the reorder-safe contract).
      expect(requestDirectUpload.mock.calls[0]![0].columnTypes).toEqual([
        { name: "a", type: "number", sourceHeader: "a" },
        { name: "b", type: "string", sourceHeader: "b" },
      ]);
    });

    /** @scenario Columns can be dragged to reorder before uploading */
    it("offers a drag handle on every confirm column", async () => {
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [csv("data.csv")]);
      await waitFor(() =>
        expect(screen.getByText(/confirm types/i)).toBeInTheDocument(),
      );
      await user.click(screen.getByText(/confirm types/i));

      // One grip per column, labelled for keyboard/AT users — the drag affordance
      // is wired without swallowing the name input / type select.
      expect(
        await screen.findByLabelText("Drag to reorder a"),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Drag to reorder b")).toBeInTheDocument();
    });

    /** @scenario A column can be excluded before uploading */
    it("excludes a column and omits it from the uploaded columnTypes", async () => {
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [csv("data.csv")]);
      await waitFor(() =>
        expect(screen.getByText(/confirm types/i)).toBeInTheDocument(),
      );
      await user.click(screen.getByText(/confirm types/i));

      // Each column has an exclude control; dropping "a" leaves only "b".
      await user.click(await screen.findByLabelText("Exclude a"));
      expect(screen.queryByLabelText("Column 1 name")).toHaveValue("b");

      await user.click(uploadButton());
      await waitFor(() => expect(requestDirectUpload).toHaveBeenCalled());
      expect(requestDirectUpload.mock.calls[0]![0].columnTypes).toEqual([
        { name: "b", type: "string", sourceHeader: "b" },
      ]);
    });

    /** @scenario A column can be excluded before uploading */
    it("never lets the user exclude the last remaining column", async () => {
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [csv("data.csv")]);
      await waitFor(() =>
        expect(screen.getByText(/confirm types/i)).toBeInTheDocument(),
      );
      await user.click(screen.getByText(/confirm types/i));

      // Drop one of the two columns; the survivor's exclude control is disabled
      // (a zero-column dataset is invalid).
      await user.click(await screen.findByLabelText("Exclude a"));
      expect(await screen.findByLabelText("Exclude b")).toBeDisabled();
    });

    it("blocks upload while two columns share a name, and re-enables once fixed", async () => {
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [csv("data.csv")]);
      await waitFor(() =>
        expect(screen.getByText(/confirm types/i)).toBeInTheDocument(),
      );
      await user.click(screen.getByText(/confirm types/i));

      // Rename the second column onto the first's name — normalize would collide
      // their values, so the upload must be blocked until it's resolved.
      const second = await screen.findByLabelText("Column 2 name");
      await user.clear(second);
      await user.type(second, "a");

      await waitFor(() => expect(uploadButton()).toBeDisabled());
      expect(
        screen.getAllByText(/column names must be unique/i).length,
      ).toBeGreaterThan(0);

      // Resolve the collision → the gate clears.
      await user.clear(second);
      await user.type(second, "b");
      await waitFor(() => expect(uploadButton()).toBeEnabled());
    });

    /** @scenario Files that share a name become distinct datasets */
    it("uploads same-named files under distinct names", async () => {
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [csv("data.csv")]);
      await waitFor(() => expect(screen.getByText("data")).toBeInTheDocument());
      await user.upload(fileInput(), [csv("data.csv")]);
      await waitFor(() =>
        expect(screen.getByText("data (1)")).toBeInTheDocument(),
      );

      await user.click(uploadButton());
      await waitFor(() => expect(requestDirectUpload).toHaveBeenCalledTimes(2));
      const names = requestDirectUpload.mock.calls.map((c) => c[0].name).sort();
      expect(names).toEqual(["data", "data (1)"]);
    });
  });

  describe("when one file fails", () => {
    /** @scenario One file failing does not stop the others */
    it("fails that row but the others still become ready", async () => {
      requestDirectUpload
        .mockResolvedValueOnce({
          datasetId: "dataset_ok",
          slug: "ok",
          uploadUrl: "https://s3.example/put",
        })
        .mockRejectedValueOnce(new Error("boom"));
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [csv("ok.csv"), csv("bad.csv")]);
      await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());

      await user.click(uploadButton());

      await waitFor(() =>
        expect(screen.getByText(/boom/i)).toBeInTheDocument(),
      );
      expect(
        screen.getByRole("button", { name: /retry/i }),
      ).toBeInTheDocument();
    });

    /** @scenario Retrying a failed file re-runs only that file and creates no duplicate */
    it("re-runs only the failed file on retry", async () => {
      requestDirectUpload
        .mockResolvedValueOnce({
          datasetId: "dataset_ok",
          slug: "ok",
          uploadUrl: "https://s3.example/put",
        })
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({
          datasetId: "dataset_retry",
          slug: "bad",
          uploadUrl: "https://s3.example/put",
        });
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [csv("ok.csv"), csv("bad.csv")]);
      await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());
      await user.click(uploadButton());
      await waitFor(() =>
        expect(screen.getByText(/boom/i)).toBeInTheDocument(),
      );

      const before = requestDirectUpload.mock.calls.length;
      await user.click(screen.getByRole("button", { name: /retry/i }));
      await waitFor(() =>
        expect(requestDirectUpload.mock.calls.length).toBe(before + 1),
      );
      // Only one more create — no duplicate for the already-succeeded file.
    });
  });

  describe("when a batch exceeds the dataset allowance", () => {
    /** @scenario A batch larger than my remaining dataset allowance */
    it("fails the over-allowance files with a clear message, keeps the rest", async () => {
      requestDirectUpload
        .mockResolvedValueOnce({
          datasetId: "d1",
          slug: "a",
          uploadUrl: "https://s3.example/put",
        })
        .mockRejectedValueOnce(new Error("dataset limit reached"));
      const user = userEvent.setup();
      render_();
      await user.upload(fileInput(), [csv("a.csv"), csv("b.csv")]);
      await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());
      await user.click(uploadButton());

      await waitFor(() =>
        expect(screen.getByText(/limit reached/i)).toBeInTheDocument(),
      );
    });
  });

  describe("accessibility", () => {
    /** @scenario The bulk upload flow is operable by keyboard and screen reader */
    it("labels the file picker, remove, and column controls", async () => {
      const user = userEvent.setup();
      render_();
      // The file picker is keyboard-reachable: a labelled input in the tab order
      // (not display:none), so it can be opened without a mouse.
      const picker = screen.getByLabelText(/add files for bulk upload/i);
      expect(picker).toBeInTheDocument();
      expect((picker as HTMLElement).style.display).not.toBe("none");

      await user.upload(fileInput(), [csv("data.csv")]);
      await waitFor(() => expect(screen.getByText("data")).toBeInTheDocument());

      expect(screen.getByLabelText(/remove file/i)).toBeInTheDocument();
      await user.click(screen.getByText(/confirm types/i));
      expect(await screen.findByLabelText("Column 1 name")).toBeInTheDocument();
      expect(screen.getByLabelText("Column 1 type")).toBeInTheDocument();
    });
  });
});
