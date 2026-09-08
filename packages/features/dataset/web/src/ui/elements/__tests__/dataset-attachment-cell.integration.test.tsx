/**
 * @vitest-environment jsdom
 *
 * The image and file cell editor: what it offers, what it stores, and what it
 * says when storing does not happen.
 *
 * The cells are rendered over a stub table context, which is the whole contract
 * they have with whatever hosts them. The datasets grid, the studio grid and
 * the workbench all hand them the same shape.
 *
 * Spec: specs/datasets/dataset-editor.feature.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  DatasetAttachmentTooLargeError,
  type DatasetAttachment,
  type DatasetColumnType,
} from "@langwatch/dataset-contract";
import {
  type DatasetAttachmentUpload,
  type DatasetTableContextValue,
  DatasetTableProvider,
} from "../../../model/dataset-table-context.tsx";
import { datasetImageUrl } from "../../../model/dataset-image-url.ts";
import { EditableCell } from "../editable-cell.tsx";

const STORED_PICTURE = "/api/files/proj-1/pic-1";
const STORED_DOCUMENT = "/api/files/proj-1/doc-1";

const storedPicture: DatasetAttachment = {
  id: "pic-1",
  projectId: "proj-1",
  url: STORED_PICTURE,
  fileName: "photo.png",
  mediaType: "image/png",
  sizeBytes: 12,
};

const storedDocument: DatasetAttachment = {
  ...storedPicture,
  id: "doc-1",
  url: STORED_DOCUMENT,
  fileName: "report.pdf",
  mediaType: "application/pdf",
};

const renderImage = (value: string): ReactNode | null => {
  const url = datasetImageUrl(value);
  return url ? <img alt="cell" src={url} data-testid="cell-image" /> : null;
};

type CellOptions = {
  dataType: DatasetColumnType;
  value?: string;
  isEditing?: boolean;
  uploadAttachment?: DatasetAttachmentUpload;
};

function renderCell({ dataType, value = "", isEditing = true, uploadAttachment }: CellOptions) {
  const setCellValue = vi.fn();
  const setEditingCell = vi.fn();

  const context: DatasetTableContextValue = {
    rowHeightMode: "compact",
    expandedCells: new Set<string>(),
    editingCell: isEditing ? { row: 0, columnId: "attachment" } : void 0,
    selectedCell: void 0,
    setCellValue,
    setEditingCell,
    setSelectedCell: vi.fn(),
    toggleCellExpanded: vi.fn(),
    toggleRowSelection: vi.fn(),
    renderImage,
    uploadAttachment,
  };

  const utils = render(
    <ChakraProvider value={defaultSystem}>
      <DatasetTableProvider value={context}>
        <EditableCell
          value={value}
          row={0}
          columnId="attachment"
          datasetId="ds-1"
          dataType={dataType}
        />
      </DatasetTableProvider>
    </ChakraProvider>,
  );

  return { ...utils, setCellValue, setEditingCell };
}

const pickFile = async (file: File) => {
  const input = screen.getByTestId("dataset-attachment-file-input");
  await userEvent.upload(input, file);
};

describe("given an image column", () => {
  describe("when a cell opens for editing", () => {
    /** @scenario "An image cell offers an upload and a URL field" */
    it("offers to upload an image and to enter a URL", () => {
      renderCell({ dataType: "image", uploadAttachment: vi.fn() });

      expect(screen.getByRole("button", { name: /upload image/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /or enter a url/i })).toBeInTheDocument();
    });

    it("swaps to the URL field and back", async () => {
      const user = userEvent.setup();
      renderCell({
        dataType: "image",
        value: "https://example.com/a.png",
        uploadAttachment: vi.fn(),
      });

      await user.click(screen.getByRole("button", { name: /or enter a url/i }));

      const textarea = await screen.findByRole("textbox");
      expect(textarea).toHaveValue("https://example.com/a.png");

      await user.click(screen.getByRole("button", { name: /or upload an image/i }));
      expect(screen.getByRole("button", { name: /upload image/i })).toBeInTheDocument();
    });
  });

  describe("when the reader picks a picture", () => {
    /** @scenario "Uploading a picture into an image cell fills the cell with it" */
    it("stores it and puts the stored address in the cell", async () => {
      const uploadAttachment = vi.fn(async () => storedPicture);
      const { setCellValue, setEditingCell } = renderCell({
        dataType: "image",
        uploadAttachment,
      });

      await pickFile(new File(["bytes"], "photo.png", { type: "image/png" }));

      await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1));
      expect(setCellValue).toHaveBeenCalledWith("ds-1", 0, "attachment", STORED_PICTURE);
      expect(setEditingCell).toHaveBeenCalledWith(void 0);
    });
  });

  describe("when the edit ends while an upload is in flight", () => {
    /** @scenario "An upload that lands after the edit ends leaves the cell alone" */
    it("writes nothing once the panel is gone", async () => {
      let finishUpload = (_attachment: DatasetAttachment) => {};
      const uploadAttachment = vi.fn(
        () =>
          new Promise<DatasetAttachment>((resolve) => {
            finishUpload = resolve;
          }),
      );
      const { setCellValue, unmount } = renderCell({ dataType: "image", uploadAttachment });

      await pickFile(new File(["bytes"], "photo.png", { type: "image/png" }));
      await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1));

      unmount();
      finishUpload(storedPicture);
      await Promise.resolve();

      expect(setCellValue).not.toHaveBeenCalled();
    });
  });

  describe("when a cell holds a stored picture", () => {
    /** @scenario "A stored picture is drawn in an image cell" */
    it("draws the picture from the stored address", () => {
      renderCell({ dataType: "image", value: STORED_PICTURE, isEditing: false });

      expect(screen.getByTestId("cell-image")).toHaveAttribute("src", STORED_PICTURE);
    });
  });
});

describe("given a file column", () => {
  describe("when a cell opens for editing", () => {
    /** @scenario "A file cell offers an upload and a URL field" */
    it("offers to upload a file and to enter a URL", () => {
      renderCell({ dataType: "file", uploadAttachment: vi.fn() });

      expect(screen.getByRole("button", { name: /upload file/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /or enter a url/i })).toBeInTheDocument();
    });
  });

  describe("when the reader picks a document", () => {
    /** @scenario "Uploading a document into a file cell keeps the file name" */
    it("stores it and puts the name and the stored address in the cell", async () => {
      const uploadAttachment = vi.fn(async () => storedDocument);
      const { setCellValue } = renderCell({ dataType: "file", uploadAttachment });

      await pickFile(new File(["bytes"], "report.pdf", { type: "application/pdf" }));

      await waitFor(() =>
        expect(setCellValue).toHaveBeenCalledWith(
          "ds-1",
          0,
          "attachment",
          `[report.pdf](${STORED_DOCUMENT})`,
        ),
      );
    });
  });

  describe("when a cell holds a stored document", () => {
    /** @scenario "A file cell shows the file name and opens the file" */
    it("shows the file name and links to the file in a new tab", () => {
      renderCell({
        dataType: "file",
        value: `[report.pdf](${STORED_DOCUMENT})`,
        isEditing: false,
      });

      const link = screen.getByTestId("dataset-cell-file");
      expect(link).toHaveTextContent("report.pdf");
      expect(link).toHaveAttribute("href", `${STORED_DOCUMENT}?filename=report.pdf`);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  describe("when the file is larger than the limit", () => {
    /** @scenario "A file larger than the limit is refused" */
    it("says the file is too large and keeps the value the cell had", async () => {
      const uploadAttachment = vi.fn(async () => {
        throw new DatasetAttachmentTooLargeError();
      });
      const { setCellValue } = renderCell({
        dataType: "file",
        value: "https://example.com/old.pdf",
        uploadAttachment,
      });

      await pickFile(new File(["bytes"], "huge.pdf", { type: "application/pdf" }));

      expect(await screen.findByTestId("dataset-attachment-error")).toHaveTextContent(/too large/i);
      expect(setCellValue).not.toHaveBeenCalled();
    });
  });

  describe("when storing the file fails", () => {
    /** @scenario "A failed upload keeps the value the cell had" */
    it("says why and keeps the value the cell had", async () => {
      const uploadAttachment = vi.fn(async () => {
        throw new Error("upstream is down");
      });
      const { setCellValue } = renderCell({
        dataType: "file",
        value: "https://example.com/old.pdf",
        uploadAttachment,
      });

      await pickFile(new File(["bytes"], "report.pdf", { type: "application/pdf" }));

      const failure = await screen.findByTestId("dataset-attachment-error");
      expect(failure).toBeInTheDocument();
      expect(failure).not.toHaveTextContent("upstream is down");
      expect(setCellValue).not.toHaveBeenCalled();
    });
  });
});
