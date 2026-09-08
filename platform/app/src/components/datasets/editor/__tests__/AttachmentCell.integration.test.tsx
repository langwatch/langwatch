/**
 * @vitest-environment jsdom
 *
 * Integration tests for the attachment cell: the body of an `image` or a
 * `file` column in the shared dataset grid.
 *
 * Renders the real EditableCell over a DatasetTableContext, so the branch that
 * picks the attachment body, the upload client and the cell states are all
 * covered together. Only the project hook and `fetch` are mocked.
 *
 * @see specs/datasets/dataset-attachment-cells.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { DatasetColumnType } from "~/server/datasets/types";
import {
  type CellPosition,
  type DatasetTableContextValue,
  DatasetTableProvider,
} from "../DatasetTableContext";
import { EditableCell } from "../EditableCell";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme-app" },
    organization: { id: "org-1", name: "Acme" },
    team: { id: "team-1", name: "Platform" },
    hasPermission: () => true,
  }),
}));

const fetchMock = vi.fn();
const setCellValue = vi.fn();

const COLUMN_ID = "attachment";
const DATASET_ID = "dataset-1";

function Harness({
  initialValue,
  dataType,
}: {
  initialValue: string;
  dataType: DatasetColumnType;
}) {
  const [value, setValue] = useState(initialValue);
  const [editingCell, setEditingCell] = useState<CellPosition | undefined>(
    undefined,
  );

  const context: DatasetTableContextValue = {
    rowHeightMode: "compact",
    expandedCells: new Set<string>(),
    editingCell,
    selectedCell: undefined,
    setCellValue: (datasetId, row, columnId, next) => {
      setCellValue(datasetId, row, columnId, next);
      setValue(next);
    },
    setEditingCell,
    setSelectedCell: vi.fn(),
    toggleCellExpanded: vi.fn(),
    toggleRowSelection: vi.fn(),
  };

  return (
    <DatasetTableProvider value={context}>
      <table>
        <tbody>
          <tr>
            <td>
              <EditableCell
                value={value}
                row={0}
                columnId={COLUMN_ID}
                datasetId={DATASET_ID}
                dataType={dataType}
              />
            </td>
          </tr>
        </tbody>
      </table>
    </DatasetTableProvider>
  );
}

function renderCell({
  value = "",
  dataType,
}: {
  value?: string;
  dataType: DatasetColumnType;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Harness initialValue={value} dataType={dataType} />
    </ChakraProvider>,
  );
}

const fileInput = (): HTMLInputElement =>
  screen.getByTestId("attachment-file-input");

const respondWith = (body: unknown, status = 200) => {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
};

const storedPicture = {
  url: "/api/files/proj-1/obj-1/cat.png",
  name: "cat.png",
  mediaType: "image/png",
  sizeBytes: 12,
};

const storedDocument = {
  url: "/api/files/proj-1/obj-2/report.pdf",
  name: "report.pdf",
  mediaType: "application/pdf",
  sizeBytes: 34,
};

const pictureFile = () =>
  new File(["picture-bytes"], "cat.png", { type: "image/png" });

const documentFile = () =>
  new File(["document-bytes"], "report.pdf", { type: "application/pdf" });

describe("AttachmentCell", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    setCellValue.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe("given an empty image cell", () => {
    /** @scenario An empty image cell offers upload or a URL */
    it("offers an upload button and a link to enter an address", () => {
      renderCell({ dataType: "image" });

      expect(
        screen.getByRole("button", { name: "Upload" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "or enter URL" }),
      ).toBeInTheDocument();
    });

    it("accepts only pictures from the file picker", () => {
      renderCell({ dataType: "image" });

      expect(fileInput()).toHaveAttribute("accept", "image/*");
    });
  });

  describe("given an empty file cell", () => {
    /** @scenario An empty file cell offers upload or a URL */
    it("offers an upload button and a link to enter an address", () => {
      renderCell({ dataType: "file" });

      expect(
        screen.getByRole("button", { name: "Upload" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "or enter URL" }),
      ).toBeInTheDocument();
    });

    it("accepts any file from the file picker", () => {
      renderCell({ dataType: "file" });

      expect(fileInput()).not.toHaveAttribute("accept");
    });
  });

  describe("when the link to enter an address is clicked", () => {
    /** @scenario The URL link opens the cell editor */
    it("opens the text editor over the cell", async () => {
      const user = userEvent.setup();
      renderCell({ dataType: "image" });

      await user.click(screen.getByRole("button", { name: "or enter URL" }));

      expect(await screen.findByRole("textbox")).toBeInTheDocument();
    });
  });

  describe("when a picture is chosen in an image cell", () => {
    /** @scenario Uploading a picture fills the image cell */
    it("uploads it and shows the stored picture", async () => {
      const user = userEvent.setup();
      respondWith(storedPicture);
      renderCell({ dataType: "image" });

      await user.upload(fileInput(), pictureFile());

      await waitFor(() =>
        expect(setCellValue).toHaveBeenCalledWith(
          DATASET_ID,
          0,
          COLUMN_ID,
          storedPicture.url,
        ),
      );
      expect(await screen.findByRole("img")).toHaveAttribute(
        "src",
        storedPicture.url,
      );

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/dataset/attachments?projectId=proj-1");
      expect(init.method).toBe("POST");
      expect((init.body as FormData).get("datasetId")).toBe(DATASET_ID);
    });
  });

  describe("when a document is chosen in a file cell", () => {
    /** @scenario Uploading a document fills the file cell */
    it("uploads it and shows the name of the document", async () => {
      const user = userEvent.setup();
      respondWith(storedDocument);
      renderCell({ dataType: "file" });

      await user.upload(fileInput(), documentFile());

      await waitFor(() =>
        expect(setCellValue).toHaveBeenCalledWith(
          DATASET_ID,
          0,
          COLUMN_ID,
          storedDocument.url,
        ),
      );
      expect(await screen.findByText("report.pdf")).toBeInTheDocument();
    });
  });

  describe("when the server refuses the file", () => {
    /** @scenario A refused upload states the reason and keeps the cell editable */
    it("states the reason and keeps the upload button", async () => {
      const user = userEvent.setup();
      respondWith(
        {
          error: "dataset_attachment_type_refused",
          message: "This file type is not accepted",
        },
        415,
      );
      renderCell({ dataType: "file" });

      await user.upload(fileInput(), documentFile());

      const message = await screen.findByTestId("attachment-upload-error");
      expect(message.textContent).not.toBe("");
      // The handled code was read: this is not the generic unknown copy.
      expect(message).not.toHaveTextContent("Something went wrong");
      expect(
        screen.getByRole("button", { name: "Upload" }),
      ).toBeInTheDocument();
    });
  });

  describe("when the file is larger than the size limit", () => {
    /** @scenario An oversize file is refused before the upload starts */
    it("states that it is too large and sends no request", async () => {
      const user = userEvent.setup();
      renderCell({ dataType: "file" });

      const oversize = documentFile();
      Object.defineProperty(oversize, "size", { value: 21 * 1024 * 1024 });
      await user.upload(fileInput(), oversize);

      const message = await screen.findByTestId("attachment-upload-error");
      expect(message).toHaveTextContent(/too large/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("given an image cell that holds an address", () => {
    /** @scenario An image address still shows a preview */
    it("shows the picture", () => {
      renderCell({
        dataType: "image",
        value: "https://example.com/cat.png",
      });

      expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        "/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fcat.png",
      );
    });

    /** @scenario A filled cell can be replaced */
    it("replaces the picture with a new upload", async () => {
      const user = userEvent.setup();
      respondWith(storedPicture);
      renderCell({ dataType: "image", value: "https://example.com/cat.png" });

      await user.click(screen.getByRole("button", { name: "Replace image" }));
      await user.upload(fileInput(), pictureFile());

      await waitFor(() =>
        expect(setCellValue).toHaveBeenCalledWith(
          DATASET_ID,
          0,
          COLUMN_ID,
          storedPicture.url,
        ),
      );
    });

    /** @scenario A filled cell can be cleared */
    it("clears the cell", async () => {
      const user = userEvent.setup();
      renderCell({ dataType: "image", value: "https://example.com/cat.png" });

      await user.click(screen.getByRole("button", { name: "Clear image" }));

      expect(setCellValue).toHaveBeenCalledWith(DATASET_ID, 0, COLUMN_ID, "");
      expect(
        await screen.findByRole("button", { name: "Upload" }),
      ).toBeInTheDocument();
    });
  });

  describe("given a file cell that holds an address on another site", () => {
    /** @scenario A file cell with an address on another site shows a name */
    it("shows the last part of the address", () => {
      renderCell({
        dataType: "file",
        value: "https://files.example.com/reports/q1.pdf",
      });

      expect(screen.getByText("q1.pdf")).toBeInTheDocument();
    });

    /** @scenario A file cell with an address on another site shows a name */
    it("shows the host when the address has no path", () => {
      renderCell({ dataType: "file", value: "https://files.example.com/" });

      expect(screen.getByText("files.example.com")).toBeInTheDocument();
    });
  });

  describe("given a file cell that holds a stored document", () => {
    /** @scenario A file chip opens the file in a new tab */
    it("links to the file in a new tab", () => {
      renderCell({ dataType: "file", value: storedDocument.url });

      const link = screen.getByRole("link", { name: /report\.pdf/ });
      expect(link).toHaveAttribute("href", storedDocument.url);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });
  });

  describe("given a file cell that holds plain text", () => {
    it("renders the text, as any other column does", () => {
      renderCell({ dataType: "file", value: "not an address" });

      expect(screen.getByText("not an address")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  describe("given a file cell that holds the bytes inline", () => {
    /** @scenario A data URL opens only for a type the browser shows */
    it("links to a document the browser shows", () => {
      const pdf = "data:application/pdf;base64,JVBERi0=";
      renderCell({ dataType: "file", value: pdf });

      expect(screen.getByRole("link")).toHaveAttribute("href", pdf);
    });

    it("renders any other type as plain text, with no link", () => {
      renderCell({
        dataType: "file",
        value: "data:text/html;base64,PGI+eDwvYj4=",
      });

      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });
});
