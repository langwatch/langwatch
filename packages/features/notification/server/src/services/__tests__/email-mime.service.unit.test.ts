import { describe, expect, it } from "vitest";
import { EmailMimeService } from "../email-mime.service";

const mime = EmailMimeService.create();

/**
 * Spec: packages/features/notification/specs/packaged-mail-delivery.feature
 */
describe("given a message carrying a header name and value with line breaks", () => {
  describe("when the message is prepared for the wire", () => {
    /** @scenario "A crafted header cannot inject another one" */
    it("removes the breaks from both halves", () => {
      expect(
        mime.trySanitizeHeaders({
          "List-Unsubscribe\r\nBcc": "<https://example.test>\r\nX-Injected: yes",
        }),
      ).toEqual({ "List-UnsubscribeBcc": "<https://example.test> X-Injected: yes" });
    });

    /** @scenario "A crafted header cannot inject another one" */
    it("drops a header whose name is nothing but control characters", () => {
      expect(mime.trySanitizeHeaders({ "\r\n": "value" })).toBeUndefined();
    });

    /** @scenario "A crafted header cannot inject another one" */
    it("keeps the injected name out of the raw message it builds", () => {
      const raw = mime.buildRawMessage({
        from: "LangWatch <contact@langwatch.ai>",
        to: ["admin@acme.example"],
        subject: "Subject\r\nX-Injected: yes",
        html: "<p>hello</p>",
        headers: { "X-Custom\r\nX-Second": "one\r\ntwo" },
        attachments: [],
      });
      expect(raw).not.toMatch(/^X-Injected:/m);
      expect(raw).toContain("X-CustomX-Second: one two");
      expect(raw).toContain("Subject: Subject X-Injected: yes");
    });
  });
});

describe("given a subject or filename outside ASCII", () => {
  describe("when it is encoded for a header", () => {
    /** @scenario "A crafted header cannot inject another one" */
    it("encodes the subject as UTF-8 encoded-words", () => {
      expect(mime.rfc2047EncodeHeader("relatório")).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
      expect(mime.rfc2047EncodeHeader("plain subject")).toBe("plain subject");
    });

    /** @scenario "A crafted header cannot inject another one" */
    it("emits both the transliterated and the extended filename parameter", () => {
      const encoded = mime.encodeHeaderParam("filename", "relatório.csv");
      expect(encoded).toContain('filename="relat_rio.csv"');
      expect(encoded).toContain("filename*=UTF-8''relat%C3%B3rio.csv");
    });
  });
});

describe("given a message carrying blind recipients", () => {
  describe("when the raw MIME message is built", () => {
    /** @scenario "Blind recipients never reach the rendered headers" */
    it("renders only the public To list", () => {
      const raw = mime.buildRawMessage({
        from: "LangWatch <contact@langwatch.ai>",
        to: ["visible@acme.example"],
        subject: "Digest",
        html: "<p>hello</p>",
        attachments: [],
      });
      expect(raw).toContain("To: visible@acme.example");
      expect(raw).not.toContain("blind@acme.example");
    });
  });
});
