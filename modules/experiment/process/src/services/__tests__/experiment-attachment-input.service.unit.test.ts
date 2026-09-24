/** @see specs/experiments-v3/attachment-inputs.feature */
import { createApiFixture } from "@langwatch/api-fixture";
import { HandledError } from "@langwatch/handled-error";
import {
  StoredObjectNotFoundError,
  type StoredObjectApi,
  type StoredObjectFileRead,
} from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";

import { MemoryExperimentAttachmentLinkChannel } from "../../channels/memory/memory.experiment-attachment-link.channel.ts";
import { ExperimentAttachmentInputService } from "../experiment-attachment-input.service.ts";

const PROJECT_ID = "project-1";
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const PDF_BYTES = Buffer.from("%PDF-1.7");

const columnTypes =
  (types: Record<string, string>) =>
  (field: string): string | undefined =>
    types[field];

type StoredFile = { mediaType: string; bytes: Buffer; purpose?: string };

/** A stored-object double answering one file for every id, and what it was asked. */
function setup(stored: StoredFile | null = null) {
  const reads: { projectId: string; id: string }[] = [];
  const closed: boolean[] = [];
  const storedObjects = createApiFixture<StoredObjectApi>(
    {
      readById: async (input): Promise<StoredObjectFileRead> => {
        reads.push(input);
        if (!stored) throw new StoredObjectNotFoundError();
        const file = stored;
        const bytes = (): AsyncIterable<Uint8Array> => ({
          [Symbol.asyncIterator]: () => {
            let sent = false;
            return {
              next: async (): Promise<IteratorResult<Uint8Array>> => {
                if (sent) return { done: true, value: undefined };
                sent = true;
                return { done: false, value: new Uint8Array(file.bytes) };
              },
              return: async (): Promise<IteratorResult<Uint8Array>> => {
                closed.push(true);
                return { done: true, value: undefined };
              },
            };
          },
        });
        return {
          row: {
            id: input.id,
            purpose: file.purpose ?? "dataset_attachment",
            owner_kind: "dataset",
            media_type: file.mediaType,
            size_bytes: file.bytes.byteLength,
          },
          stream: bytes(),
        };
      },
    },
    "storedObjects",
  );
  const links = MemoryExperimentAttachmentLinkChannel.create();
  const attachments = ExperimentAttachmentInputService.create({ storedObjects, links });

  return { attachments, links, reads, closed };
}

describe("given a row with a stored attachment", () => {
  describe("when an image column is mapped", () => {
    /** @scenario "A stored image reaches the model as base64" */
    it("sends a base64 image data URL with no name", async () => {
      const { attachments } = setup({ mediaType: "image/png", bytes: PNG_BYTES });

      const resolved = await attachments.resolveInputs({
        projectId: PROJECT_ID,
        inputs: { picture: `/api/files/${PROJECT_ID}/obj-1/shot.png` },
        columnTypeOfInput: columnTypes({ picture: "image" }),
        shouldFetchExternal: false,
      });

      expect(resolved.picture).toBe(`data:image/png;base64,${PNG_BYTES.toString("base64")}`);
    });
  });

  describe("when a file column is mapped", () => {
    /** @scenario "A stored file reaches the model as base64 with its name" */
    it("sends a base64 file data URL that carries the file name", async () => {
      const { attachments } = setup({ mediaType: "application/pdf", bytes: PDF_BYTES });

      const resolved = await attachments.resolveInputs({
        projectId: PROJECT_ID,
        inputs: { document: `/api/files/${PROJECT_ID}/obj-2/quarter%20one.pdf` },
        columnTypeOfInput: columnTypes({ document: "file" }),
        shouldFetchExternal: false,
      });

      expect(resolved.document).toBe(
        `data:application/pdf;name=quarter%20one.pdf;base64,${PDF_BYTES.toString("base64")}`,
      );
    });

    /** @scenario "An agent receives base64 for a stored reference" */
    it("sends the same data URL to an agent, never the reference", async () => {
      const { attachments, links } = setup({ mediaType: "application/pdf", bytes: PDF_BYTES });

      const resolved = await attachments.resolveInputs({
        projectId: PROJECT_ID,
        inputs: { document: `/api/files/${PROJECT_ID}/obj-2/quarter.pdf` },
        columnTypeOfInput: columnTypes({ document: "file" }),
        shouldFetchExternal: true,
      });

      expect(resolved.document).toContain("data:application/pdf;");
      expect(resolved.document).not.toContain("/api/files/");
      expect(links.asked).toEqual([]);
    });

    /** @scenario "A connected agent parameter mapped to a file column receives base64" */
    it("resolves a parameter input the same way as any other input", async () => {
      const { attachments } = setup({ mediaType: "application/pdf", bytes: PDF_BYTES });

      const resolved = await attachments.resolveInputs({
        projectId: PROJECT_ID,
        inputs: { input: "read this", document: `/api/files/${PROJECT_ID}/obj-2/quarter.pdf` },
        columnTypeOfInput: columnTypes({ input: "string", document: "file" }),
        shouldFetchExternal: true,
      });

      expect(resolved.input).toBe("read this");
      expect(resolved.document).toBe(
        `data:application/pdf;name=quarter.pdf;base64,${PDF_BYTES.toString("base64")}`,
      );
    });
  });

  describe("when the object no longer resolves", () => {
    /** @scenario "A missing stored object fails the cell" */
    it("fails with the attachment unavailable code and names the file", async () => {
      const { attachments } = setup(null);

      const failure = await attachments
        .resolveInputs({
          projectId: PROJECT_ID,
          inputs: { document: `/api/files/${PROJECT_ID}/obj-3/quarter.pdf` },
          columnTypeOfInput: columnTypes({ document: "file" }),
          shouldFetchExternal: false,
        })
        .catch((error: unknown) => error);

      expect(HandledError.isHandled(failure)).toBe(true);
      expect(failure).toMatchObject({
        code: "dataset_attachment_unavailable",
        meta: { fileName: "quarter.pdf" },
      });
    });
  });

  describe("when the reference names another project", () => {
    it("fails rather than reading across projects", async () => {
      const { attachments, reads } = setup({ mediaType: "application/pdf", bytes: PDF_BYTES });

      await expect(
        attachments.resolveInputs({
          projectId: PROJECT_ID,
          inputs: { document: "/api/files/project-2/obj-4/quarter.pdf" },
          columnTypeOfInput: columnTypes({ document: "file" }),
          shouldFetchExternal: false,
        }),
      ).rejects.toMatchObject({ code: "dataset_attachment_unavailable" });
      expect(reads).toEqual([]);
    });
  });

  describe("when the object is kept for another purpose", () => {
    /** @scenario "A stored object of another purpose is not readable as an attachment" */
    it("reads as gone and closes the stream, so the run never carries trace media", async () => {
      const { attachments, closed } = setup({
        mediaType: "application/pdf",
        bytes: PDF_BYTES,
        purpose: "trace_content",
      });

      await expect(
        attachments.resolveInputs({
          projectId: PROJECT_ID,
          inputs: { document: `/api/files/${PROJECT_ID}/obj-1/quarter.pdf` },
          columnTypeOfInput: columnTypes({ document: "file" }),
          shouldFetchExternal: false,
        }),
      ).rejects.toMatchObject({ code: "dataset_attachment_unavailable" });
      expect(closed).toEqual([true]);
    });
  });
});

describe("given a row with an address on the public internet", () => {
  describe("when the target is an agent", () => {
    /** @scenario "An agent receives base64 for an address on the public internet" */
    it("reads the address and sends the bytes", async () => {
      const { attachments, links } = setup();
      links.seed({
        url: "https://example.com/shot.jpg",
        attachment: { mediaType: "image/jpeg", bytes: PNG_BYTES },
      });

      const resolved = await attachments.resolveInputs({
        projectId: PROJECT_ID,
        inputs: { picture: "https://example.com/shot.jpg" },
        columnTypeOfInput: columnTypes({ picture: "image" }),
        shouldFetchExternal: true,
      });

      expect(links.asked).toEqual([{ url: "https://example.com/shot.jpg", columnType: "image" }]);
      expect(resolved.picture).toBe(`data:image/jpeg;base64,${PNG_BYTES.toString("base64")}`);
    });
  });

  describe("when the target is a prompt", () => {
    /** @scenario "A prompt keeps an address on the public internet" */
    it("sends the address as it is", async () => {
      const { attachments, links } = setup();
      const inputs = { picture: "https://example.com/shot.jpg" };

      const resolved = await attachments.resolveInputs({
        projectId: PROJECT_ID,
        inputs,
        columnTypeOfInput: columnTypes({ picture: "image" }),
        shouldFetchExternal: false,
      });

      expect(resolved).toBe(inputs);
      expect(links.asked).toEqual([]);
    });
  });

  describe("when the column holds text", () => {
    /** @scenario "A text column that holds an address is not read" */
    it("leaves the sentence alone", async () => {
      const { attachments, links } = setup();

      const resolved = await attachments.resolveInputs({
        projectId: PROJECT_ID,
        inputs: { notes: "see https://example.com/report.pdf" },
        columnTypeOfInput: columnTypes({ notes: "string" }),
        shouldFetchExternal: true,
      });

      expect(resolved.notes).toBe("see https://example.com/report.pdf");
      expect(links.asked).toEqual([]);
    });
  });
});

describe("given a text column that holds a LangWatch reference", () => {
  describe("when the inputs are resolved", () => {
    /** @scenario "A text column that holds a LangWatch reference is not read" */
    it("keeps the reference as the sentence it is", async () => {
      const { attachments, reads } = setup({ mediaType: "application/pdf", bytes: PDF_BYTES });
      const inputs = { notes: `/api/files/${PROJECT_ID}/obj-9/quarter.pdf` };

      const resolved = await attachments.resolveInputs({
        projectId: PROJECT_ID,
        inputs,
        columnTypeOfInput: columnTypes({ notes: "string" }),
        shouldFetchExternal: true,
      });

      expect(resolved).toBe(inputs);
      expect(reads).toEqual([]);
    });
  });
});

describe("given a row with no attachment", () => {
  describe("when the inputs are resolved", () => {
    it("returns the same record, so nothing is copied", async () => {
      const { attachments } = setup();
      const inputs = { question: "what changed?", count: 3, empty: "" };

      await expect(
        attachments.resolveInputs({
          projectId: PROJECT_ID,
          inputs,
          columnTypeOfInput: () => undefined,
          shouldFetchExternal: true,
        }),
      ).resolves.toBe(inputs);
    });
  });
});
