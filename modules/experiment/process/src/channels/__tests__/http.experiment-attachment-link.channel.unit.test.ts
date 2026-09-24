/** @see specs/experiments-v3/attachment-inputs.feature */
import { DATASET_ATTACHMENT_MAX_BYTES } from "@langwatch/dataset-contract";
import type { SsrfValidationResult } from "@langwatch/egress";
import { describe, expect, it } from "vitest";

import {
  type AttachmentLinkResponse,
  HttpExperimentAttachmentLinkChannel,
} from "../http/http.experiment-attachment-link.channel.ts";

const PDF_BYTES = Buffer.from("%PDF-1.7");

/** Answers with the given headers and body, and reports whether the body was reached. */
function answering({ headers, chunks }: { headers: Record<string, string>; chunks: Buffer[] }) {
  const reached: boolean[] = [];
  const response: AttachmentLinkResponse = {
    ok: true,
    headers: new Headers(headers),
    get body() {
      reached.push(true);
      let index = 0;
      return {
        getReader: () => ({
          read: async () =>
            index < chunks.length
              ? { done: false, value: new Uint8Array(chunks[index++]!) }
              : { done: true },
          cancel: async () => undefined,
        }),
      };
    },
  };
  const channel = HttpExperimentAttachmentLinkChannel.create({
    policy: { blockLocal: true, allowedHosts: [], verifyTls: true },
    validate: async (url): Promise<SsrfValidationResult> => ({
      type: "resolved",
      resolvedIp: "93.184.216.34",
      originalUrl: url,
      hostname: "example.com",
      port: 443,
      protocol: "https:",
      path: new URL(url).pathname,
    }),
    fetchValidated: async () => response,
  });

  return { channel, reached };
}

describe("the attachment link channel", () => {
  describe("when the answer declares a size over the ceiling", () => {
    /** @scenario "An address that declares a size over the ceiling is refused before it is read" */
    it("refuses it without reading the body", async () => {
      const { channel, reached } = answering({
        headers: {
          "content-type": "application/pdf",
          "content-length": String(DATASET_ATTACHMENT_MAX_BYTES + 1),
        },
        chunks: [PDF_BYTES],
      });

      await expect(
        channel.fetchAttachment({ url: "https://example.com/report.pdf", columnType: "file" }),
      ).rejects.toMatchObject({ code: "dataset_attachment_too_large" });
      expect(reached).toEqual([]);
    });
  });

  describe("when the answer declares no size and keeps sending", () => {
    /** @scenario "An address that keeps sending past the ceiling is cut" */
    it("cuts the read at the ceiling", async () => {
      const chunk = Buffer.alloc(1024 * 1024);
      const { channel } = answering({
        headers: { "content-type": "application/pdf" },
        chunks: Array.from({ length: 21 }, () => chunk),
      });

      await expect(
        channel.fetchAttachment({ url: "https://example.com/report.pdf", columnType: "file" }),
      ).rejects.toMatchObject({ code: "dataset_attachment_too_large" });
    });
  });

  describe("when an image column names an address that serves something else", () => {
    /** @scenario "An address in an image input that serves something else fails the cell" */
    it("refuses it and names the file", async () => {
      const { channel } = answering({
        headers: { "content-type": "text/html; charset=utf-8" },
        chunks: [Buffer.from("<html></html>")],
      });

      await expect(
        channel.fetchAttachment({ url: "https://example.com/page.html", columnType: "image" }),
      ).rejects.toMatchObject({
        code: "dataset_attachment_unavailable",
        meta: { fileName: "page.html" },
      });
    });
  });

  describe("when a file column names the same address", () => {
    /** @scenario "A file-typed input accepts any content type" */
    it("reads it, because the field was declared a file", async () => {
      const { channel } = answering({
        headers: { "content-type": "text/html; charset=utf-8" },
        chunks: [Buffer.from("<html></html>")],
      });

      await expect(
        channel.fetchAttachment({ url: "https://example.com/page.html", columnType: "file" }),
      ).resolves.toMatchObject({ mediaType: "text/html", name: "page.html" });
    });
  });
});
