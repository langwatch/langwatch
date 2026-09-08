/**
 * @vitest-environment jsdom
 *
 * Reading a picked file, and the value the cell keeps for it.
 *
 * jsdom for `FileReader` and `File`, which is the browser capability this
 * module is about; nothing here renders.
 *
 * Spec: specs/datasets/dataset-editor.feature.
 */

import { describe, expect, it, vi } from "vitest";

import { DATASET_ATTACHMENT_MAX_BYTES, type DatasetAttachment } from "@langwatch/dataset-contract";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import {
  datasetAttachmentCellValue,
  datasetAttachmentDisplayName,
  datasetAttachmentOpenUrl,
  readDatasetAttachmentFile,
} from "../dataset-attachment-file.ts";

const attachment: DatasetAttachment = {
  id: "doc-1",
  projectId: "proj-1",
  url: "/api/files/proj-1/doc-1",
  fileName: "report.pdf",
  mediaType: "application/pdf",
  sizeBytes: 4,
};

/** A file of the given size without holding the bytes for it. */
function fileOfSize({ sizeBytes, name }: { sizeBytes: number; name: string }): File {
  const file = new File(["x"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

describe("given a file the reader picked", () => {
  describe("when it is within the limit", () => {
    it("reads it into a base64 address", async () => {
      const read = await readDatasetAttachmentFile(
        new File(["hello"], "report.pdf", { type: "application/pdf" }),
      );

      expect(read.fileName).toBe("report.pdf");
      expect(read.dataUrl.startsWith("data:application/pdf;base64,")).toBe(true);
    });
  });

  describe("when it is larger than the limit", () => {
    /** @scenario "A file larger than the limit never leaves the browser" */
    it("refuses it without reading the bytes", async () => {
      const readAsDataUrl = vi.spyOn(FileReader.prototype, "readAsDataURL");

      const failure = await readDatasetAttachmentFile(
        fileOfSize({ sizeBytes: DATASET_ATTACHMENT_MAX_BYTES + 1, name: "huge.pdf" }),
      ).catch((error: unknown) => error);

      expect(readHandledError(failure)?.code).toBe("dataset_attachment_too_large");
      expect(readAsDataUrl).not.toHaveBeenCalled();
      readAsDataUrl.mockRestore();
    });
  });
});

describe("given a stored attachment", () => {
  describe("when the column holds files", () => {
    it("keeps the name alongside the address", () => {
      expect(datasetAttachmentCellValue({ dataType: "file", attachment })).toBe(
        "[report.pdf](/api/files/proj-1/doc-1)",
      );
    });
  });

  describe("when the column holds pictures", () => {
    it("keeps the address alone", () => {
      expect(datasetAttachmentCellValue({ dataType: "image", attachment })).toBe(
        "/api/files/proj-1/doc-1",
      );
    });
  });
});

describe("given a value in a file cell", () => {
  describe("when it names a file", () => {
    it("reads the stored name, else the last segment of the address", () => {
      expect(datasetAttachmentDisplayName("[report.pdf](/api/files/p/1)")).toBe("report.pdf");
      expect(datasetAttachmentDisplayName("https://example.com/files/notes%20v2.pdf")).toBe(
        "notes v2.pdf",
      );
      expect(datasetAttachmentDisplayName("data:application/pdf;base64,AAAA")).toBe("File");
    });
  });

  describe("when it names no file", () => {
    it("answers with nothing", () => {
      expect(datasetAttachmentDisplayName("just some text")).toBeNull();
      expect(datasetAttachmentDisplayName("")).toBeNull();
    });
  });

  describe("when the cell opens it", () => {
    it("asks the serving route for the name a stored file was uploaded under", () => {
      expect(datasetAttachmentOpenUrl("[my report v2.pdf](/api/files/p/1)")).toBe(
        "/api/files/p/1?filename=my%20report%20v2.pdf",
      );
    });

    it("leaves an address it does not serve exactly as it is", () => {
      expect(datasetAttachmentOpenUrl("[notes.pdf](https://example.com/a.pdf)")).toBe(
        "https://example.com/a.pdf",
      );
      expect(datasetAttachmentOpenUrl("/api/files/p/1")).toBe("/api/files/p/1");
      expect(datasetAttachmentOpenUrl("just some text")).toBeNull();
    });
  });
});
