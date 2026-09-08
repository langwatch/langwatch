/**
 * Attachments a row carries into the target it runs.
 *
 * @see specs/experiments-v3/attachment-inputs.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";
import {
  type ExternalAttachmentReader,
  resolveAttachmentInputs,
  type StoredAttachmentReader,
} from "../attachments";

const PROJECT_ID = "project-1";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const PDF_BYTES = Buffer.from("%PDF-1.7");

const columnTypes =
  (types: Record<string, string>) =>
  (field: string): string | undefined =>
    types[field];

const storedReader = (
  bytes: { mediaType: string; bytes: Buffer } | null,
): StoredAttachmentReader => vi.fn(async () => bytes);

const externalReader = (mediaType: string, bytes: Buffer, name?: string) =>
  vi.fn(async () => ({ mediaType, bytes, name })) as ExternalAttachmentReader;

const refusingExternalReader = vi.fn(async () => {
  throw new Error("the run must not read this address");
}) as ExternalAttachmentReader;

describe("given a row with a stored attachment", () => {
  describe("when an image column is mapped", () => {
    /** @scenario "A stored image reaches the model as base64" */
    it("sends a base64 image data URL with no name", async () => {
      const resolved = await resolveAttachmentInputs({
        projectId: PROJECT_ID,
        inputs: { picture: `/api/files/${PROJECT_ID}/obj-1/shot.png` },
        columnTypeOfInput: columnTypes({ picture: "image" }),
        fetchExternal: false,
        readStoredAttachment: storedReader({
          mediaType: "image/png",
          bytes: PNG_BYTES,
        }),
        readExternalAttachment: refusingExternalReader,
      });

      expect(resolved.picture).toBe(
        `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
      );
    });
  });

  describe("when a file column is mapped", () => {
    /** @scenario "A stored file reaches the model as base64 with its name" */
    it("sends a base64 file data URL that carries the file name", async () => {
      const resolved = await resolveAttachmentInputs({
        projectId: PROJECT_ID,
        inputs: {
          document: `/api/files/${PROJECT_ID}/obj-2/quarter%20one.pdf`,
        },
        columnTypeOfInput: columnTypes({ document: "file" }),
        fetchExternal: false,
        readStoredAttachment: storedReader({
          mediaType: "application/pdf",
          bytes: PDF_BYTES,
        }),
        readExternalAttachment: refusingExternalReader,
      });

      expect(resolved.document).toBe(
        `data:application/pdf;name=quarter%20one.pdf;base64,${PDF_BYTES.toString(
          "base64",
        )}`,
      );
    });

    /** @scenario "An agent receives base64 for a stored reference" */
    it("sends the same data URL to an agent, never the reference", async () => {
      const resolved = await resolveAttachmentInputs({
        projectId: PROJECT_ID,
        inputs: { document: `/api/files/${PROJECT_ID}/obj-2/quarter.pdf` },
        columnTypeOfInput: columnTypes({ document: "file" }),
        fetchExternal: true,
        readStoredAttachment: storedReader({
          mediaType: "application/pdf",
          bytes: PDF_BYTES,
        }),
        readExternalAttachment: refusingExternalReader,
      });

      expect(resolved.document).toContain("data:application/pdf;");
      expect(resolved.document).not.toContain("/api/files/");
    });

    /** @scenario "A connected agent parameter mapped to a file column receives base64" */
    it("resolves a parameter input the same way as any other input", async () => {
      const resolved = await resolveAttachmentInputs({
        projectId: PROJECT_ID,
        inputs: {
          input: "read this",
          document: `/api/files/${PROJECT_ID}/obj-2/quarter.pdf`,
        },
        columnTypeOfInput: columnTypes({ input: "string", document: "file" }),
        fetchExternal: true,
        readStoredAttachment: storedReader({
          mediaType: "application/pdf",
          bytes: PDF_BYTES,
        }),
        readExternalAttachment: refusingExternalReader,
      });

      expect(resolved.input).toBe("read this");
      expect(resolved.document).toBe(
        `data:application/pdf;name=quarter.pdf;base64,${PDF_BYTES.toString(
          "base64",
        )}`,
      );
    });
  });

  describe("when the object no longer resolves", () => {
    /** @scenario "A missing stored object fails the cell" */
    it("fails with the attachment unavailable code and names the file", async () => {
      const failure = await resolveAttachmentInputs({
        projectId: PROJECT_ID,
        inputs: { document: `/api/files/${PROJECT_ID}/obj-3/quarter.pdf` },
        columnTypeOfInput: columnTypes({ document: "file" }),
        fetchExternal: false,
        readStoredAttachment: storedReader(null),
        readExternalAttachment: refusingExternalReader,
      }).catch((error: unknown) => error);

      expect(HandledError.isHandled(failure)).toBe(true);
      const handled = failure as HandledError;
      expect(handled.code).toBe("dataset_attachment_unavailable");
      expect(handled.meta).toMatchObject({ fileName: "quarter.pdf" });
    });
  });

  describe("when the reference names another project", () => {
    it("fails rather than reading across projects", async () => {
      const read = storedReader({
        mediaType: "application/pdf",
        bytes: PDF_BYTES,
      });

      const failure = await resolveAttachmentInputs({
        projectId: PROJECT_ID,
        inputs: { document: "/api/files/project-2/obj-4/quarter.pdf" },
        columnTypeOfInput: columnTypes({ document: "file" }),
        fetchExternal: false,
        readStoredAttachment: read,
        readExternalAttachment: refusingExternalReader,
      }).catch((error: unknown) => error);

      expect((failure as HandledError).code).toBe(
        "dataset_attachment_unavailable",
      );
      expect(read).not.toHaveBeenCalled();
    });
  });
});

describe("given a row with an address on the public internet", () => {
  describe("when the target is an agent", () => {
    /** @scenario "An agent receives base64 for an address on the public internet" */
    it("reads the address and sends the bytes", async () => {
      const read = externalReader("image/jpeg", PNG_BYTES);

      const resolved = await resolveAttachmentInputs({
        projectId: PROJECT_ID,
        inputs: { picture: "https://example.com/shot.jpg" },
        columnTypeOfInput: columnTypes({ picture: "image" }),
        fetchExternal: true,
        readStoredAttachment: storedReader(null),
        readExternalAttachment: read,
      });

      expect(read).toHaveBeenCalledWith({
        url: "https://example.com/shot.jpg",
      });
      expect(resolved.picture).toBe(
        `data:image/jpeg;base64,${PNG_BYTES.toString("base64")}`,
      );
    });
  });

  describe("when the target is a prompt", () => {
    /** @scenario "A prompt keeps an address on the public internet" */
    it("sends the address as it is", async () => {
      const inputs = { picture: "https://example.com/shot.jpg" };

      const resolved = await resolveAttachmentInputs({
        projectId: PROJECT_ID,
        inputs,
        columnTypeOfInput: columnTypes({ picture: "image" }),
        fetchExternal: false,
        readStoredAttachment: storedReader(null),
        readExternalAttachment: refusingExternalReader,
      });

      expect(resolved).toBe(inputs);
      expect(refusingExternalReader).not.toHaveBeenCalled();
    });
  });

  describe("when the column holds text", () => {
    /** @scenario "A text column that holds an address is not read" */
    it("leaves the sentence alone", async () => {
      const inputs = { notes: "see https://example.com/report.pdf" };

      const resolved = await resolveAttachmentInputs({
        projectId: PROJECT_ID,
        inputs,
        columnTypeOfInput: columnTypes({ notes: "string" }),
        fetchExternal: true,
        readStoredAttachment: storedReader(null),
        readExternalAttachment: refusingExternalReader,
      });

      expect(resolved.notes).toBe("see https://example.com/report.pdf");
      expect(refusingExternalReader).not.toHaveBeenCalled();
    });
  });
});

describe("given a row with no attachment", () => {
  describe("when the inputs are resolved", () => {
    it("returns the same record, so nothing is copied", async () => {
      const inputs = { question: "what changed?", count: 3, empty: "" };

      const resolved = await resolveAttachmentInputs({
        projectId: PROJECT_ID,
        inputs,
        columnTypeOfInput: () => undefined,
        fetchExternal: true,
        readStoredAttachment: storedReader(null),
        readExternalAttachment: refusingExternalReader,
      });

      expect(resolved).toBe(inputs);
    });
  });
});
