/**
 * Attachments a row carries into the target it runs.
 *
 * @see specs/experiments-v3/attachment-inputs.feature
 */
import { Readable } from "node:stream";
import { HandledError } from "@langwatch/handled-error";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ExternalAttachmentReader,
  externalAttachmentReader,
  MAX_ATTACHMENT_BYTES,
  resolveAttachmentInputs,
  type StoredAttachmentReader,
  storedAttachmentReader,
} from "../attachments";

const { mockGetById, mockSsrfSafeFetch } = vi.hoisted(() => ({
  mockGetById: vi.fn(),
  mockSsrfSafeFetch: vi.fn(),
}));

vi.mock("~/server/stored-objects/stored-objects-factory", () => ({
  createStoredObjectsService: () => ({ getById: mockGetById }),
}));

vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: mockSsrfSafeFetch,
}));

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
        columnType: "image",
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

describe("given the production reader of a stored attachment", () => {
  beforeEach(() => {
    mockGetById.mockReset();
  });

  describe("when the object is kept as a dataset attachment", () => {
    it("reads its bytes and its media type", async () => {
      mockGetById.mockResolvedValue({
        row: { purpose: "dataset_attachment", media_type: "application/pdf" },
        stream: Readable.from([PDF_BYTES]),
      });

      const found = await storedAttachmentReader({
        projectId: PROJECT_ID,
        objectId: "obj-1",
      });

      expect(found).toEqual({
        mediaType: "application/pdf",
        bytes: PDF_BYTES,
      });
    });
  });

  describe("when the object is kept for another purpose", () => {
    /** @scenario "A stored object of another purpose is not readable as an attachment" */
    it("reads as gone, so the run never carries trace media", async () => {
      const stream = Readable.from([PDF_BYTES]);
      mockGetById.mockResolvedValue({
        row: { purpose: "trace_content", media_type: "application/pdf" },
        stream,
      });

      const found = await storedAttachmentReader({
        projectId: PROJECT_ID,
        objectId: "obj-1",
      });

      expect(found).toBeNull();
      expect(stream.destroyed).toBe(true);
    });
  });
});

describe("given the production reader of an address on the public internet", () => {
  beforeEach(() => {
    mockSsrfSafeFetch.mockReset();
  });

  /**
   * Answers with the given headers and body, as `ssrfSafeFetch` does. The body
   * is built only when it is asked for, so the spy that comes back reports
   * whether the reader reached the bytes at all.
   */
  const answerWith = ({
    headers,
    chunks,
  }: {
    headers: Record<string, string>;
    chunks: Buffer[];
  }) => {
    const read = vi.fn();
    mockSsrfSafeFetch.mockResolvedValue({
      ok: true,
      headers: new Headers(headers),
      get body() {
        read();
        return new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        });
      },
    });
    return read;
  };

  describe("when the answer declares a size over the ceiling", () => {
    /** @scenario "An address that declares a size over the ceiling is refused before it is read" */
    it("refuses it without reading the body", async () => {
      const read = answerWith({
        headers: {
          "content-type": "application/pdf",
          "content-length": String(MAX_ATTACHMENT_BYTES + 1),
        },
        chunks: [PDF_BYTES],
      });

      const failure = await externalAttachmentReader({
        url: "https://example.com/report.pdf",
        columnType: "file",
      }).catch((error: unknown) => error);

      expect((failure as HandledError).code).toBe(
        "dataset_attachment_too_large",
      );
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("when the answer declares no size and keeps sending", () => {
    /** @scenario "An address that keeps sending past the ceiling is cut" */
    it("cuts the read at the ceiling", async () => {
      const chunk = Buffer.alloc(1024 * 1024);
      answerWith({
        headers: { "content-type": "application/pdf" },
        chunks: Array.from({ length: 21 }, () => chunk),
      });

      const failure = await externalAttachmentReader({
        url: "https://example.com/report.pdf",
        columnType: "file",
      }).catch((error: unknown) => error);

      expect((failure as HandledError).code).toBe(
        "dataset_attachment_too_large",
      );
    });
  });

  describe("when an image column names an address that serves something else", () => {
    /** @scenario "An address in an image input that serves something else fails the cell" */
    it("refuses it and names the file", async () => {
      answerWith({
        headers: { "content-type": "text/html; charset=utf-8" },
        chunks: [Buffer.from("<html></html>")],
      });

      const failure = await externalAttachmentReader({
        url: "https://example.com/page.html",
        columnType: "image",
      }).catch((error: unknown) => error);

      const handled = failure as HandledError;
      expect(handled.code).toBe("dataset_attachment_unavailable");
      expect(handled.meta).toMatchObject({ fileName: "page.html" });
    });
  });

  describe("when a file column names the same address", () => {
    /** @scenario "A file-typed input accepts any content type" */
    it("reads it, because the field was declared a file", async () => {
      answerWith({
        headers: { "content-type": "text/html; charset=utf-8" },
        chunks: [Buffer.from("<html></html>")],
      });

      const found = await externalAttachmentReader({
        url: "https://example.com/page.html",
        columnType: "file",
      });

      expect(found.mediaType).toBe("text/html");
      expect(found.name).toBe("page.html");
    });
  });
});
