import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock env before any module imports
vi.mock("../../../env.mjs", () => ({
  env: {
    USE_AWS_SES: true,
    AWS_REGION: "us-east-1",
    SENDGRID_API_KEY: undefined,
    EMAIL_DEFAULT_FROM: "LangWatch <contact@langwatch.ai>",
    BASE_HOST: "https://app.langwatch.ai",
  },
}));

vi.mock("../../../utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

const { sesClientSendMock } = vi.hoisted(() => ({
  sesClientSendMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-ses", () => {
  const SESClient = vi.fn(function (this: { send: typeof sesClientSendMock }) {
    this.send = sesClientSendMock;
  });
  const SendEmailCommand = vi.fn(function (
    this: { type: string; input: unknown },
    input: unknown,
  ) {
    this.type = "SendEmailCommand";
    this.input = input;
  });
  const SendRawEmailCommand = vi.fn(function (
    this: { type: string; input: unknown },
    input: unknown,
  ) {
    this.type = "SendRawEmailCommand";
    this.input = input;
  });
  return { SESClient, SendEmailCommand, SendRawEmailCommand };
});

import {
  buildRawMimeMessage,
  rfc2047EncodeHeader,
  sendEmail,
} from "../emailSender";

// ── helper ────────────────────────────────────────────────────────────────────

/** Decode the raw MIME bytes that were passed to SendRawEmailCommand */
function capturedRawMessage(): string {
  const call = sesClientSendMock.mock.calls[0];
  expect(call).toBeDefined();
  const cmd = call![0] as {
    type: string;
    input: { RawMessage: { Data: Uint8Array } };
  };
  expect(cmd.type).toBe("SendRawEmailCommand");
  return new TextDecoder().decode(cmd.input.RawMessage.Data);
}

// ── rfc2047EncodeHeader ───────────────────────────────────────────────────────

describe("rfc2047EncodeHeader", () => {
  describe("given a pure-ASCII short subject", () => {
    describe("when encoding", () => {
      it("returns the value unchanged", () => {
        const result = rfc2047EncodeHeader("Hello world");
        expect(result).toBe("Hello world");
      });
    });
  });

  describe("given a subject with non-ASCII characters", () => {
    describe("when encoding", () => {
      it("returns an RFC 2047 base64 encoded-word", () => {
        const result = rfc2047EncodeHeader("Héllo wörld");
        expect(result).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/]+=*\?=/);
      });

      it("decodes back to the original string", () => {
        const original = "Héllo wörld — café ☕";
        const encoded = rfc2047EncodeHeader(original);
        // Extract all encoded-words and decode them
        const words =
          encoded.match(/=\?UTF-8\?B\?([A-Za-z0-9+/]+=*)\?=/g) ?? [];
        expect(words.length).toBeGreaterThan(0);
        const decoded = words
          .map((w) => {
            const b64 = w.slice("=?UTF-8?B?".length, -"?=".length);
            return Buffer.from(b64, "base64").toString("utf-8");
          })
          .join("");
        expect(decoded).toBe(original);
      });

      it("keeps each encoded-word ≤75 characters (RFC 2047 §2)", () => {
        const longUnicode = "☕".repeat(30); // 30 × 3 bytes each
        const encoded = rfc2047EncodeHeader(longUnicode);
        const words = encoded.split(/\r\n\s/);
        for (const word of words) {
          expect(word.trim().length).toBeLessThanOrEqual(75);
        }
      });
    });
  });

  describe("given a long pure-ASCII subject", () => {
    describe("when encoding", () => {
      it("encodes to keep the header manageable", () => {
        // A subject longer than 75 chars of ASCII would need folding
        const long = "A".repeat(80);
        const result = rfc2047EncodeHeader(long);
        // Either it stays as-is (some implementations allow long ASCII) or it's encoded
        // — what matters is that individual encoded-words are ≤75 chars
        const words = result.split(/\r\n\s/);
        for (const word of words) {
          expect(word.trim().length).toBeLessThanOrEqual(75);
        }
      });
    });
  });
});

// ── buildRawMimeMessage ───────────────────────────────────────────────────────

describe("buildRawMimeMessage", () => {
  describe("given a Unicode subject", () => {
    describe("when building the MIME message", () => {
      it("RFC 2047-encodes the Subject header", () => {
        const msg = buildRawMimeMessage({
          from: "LangWatch <contact@langwatch.ai>",
          to: ["user@example.com"],
          subject: "Héllo — café alert ☕",
          html: "<p>Hello</p>",
          attachments: [],
        });
        const subjectLine = msg
          .split("\r\n")
          .find((l) => l.startsWith("Subject:"));
        expect(subjectLine).toBeDefined();
        // Must use encoded-word syntax
        expect(subjectLine).toMatch(/=\?UTF-8\?B\?/);
        // Must NOT contain raw non-ASCII bytes in the header line
        expect(subjectLine).not.toMatch(/[\x80-\xFF]/);
      });
    });
  });

  describe("given a Unicode HTML body", () => {
    describe("when building the MIME message", () => {
      it("declares base64 Content-Transfer-Encoding", () => {
        const msg = buildRawMimeMessage({
          from: "LangWatch <contact@langwatch.ai>",
          to: ["user@example.com"],
          subject: "Test",
          html: "<p>Héllo wörld ☕</p>",
          attachments: [],
        });
        expect(msg).toContain("Content-Transfer-Encoding: base64");
      });

      it("base64-encodes the body so no raw non-ASCII appears in the body section", () => {
        const msg = buildRawMimeMessage({
          from: "LangWatch <contact@langwatch.ai>",
          to: ["user@example.com"],
          subject: "Test",
          html: "<p>café ☕ and naïve résumé</p>",
          attachments: [],
        });

        // Body section starts after the blank line following Content-Transfer-Encoding header
        const bodyStart = msg.indexOf(
          "\r\n\r\n",
          msg.indexOf("Content-Transfer-Encoding: base64"),
        );
        const bodySection = msg.slice(bodyStart + 4); // skip the blank line

        // All characters in body must be valid base64 or CRLF/boundary chars
        const firstPart = bodySection.split("----=_Part_")[0]!;
        expect(firstPart).not.toMatch(/[\x80-\xFF]/);

        // Decode to verify it round-trips
        const b64Lines = firstPart.replace(/\r\n/g, "");
        const decoded = Buffer.from(b64Lines, "base64").toString("utf-8");
        expect(decoded).toContain("café");
        expect(decoded).toContain("☕");
      });
    });
  });

  describe("given a long HTML body", () => {
    describe("when building the MIME message", () => {
      it("folds base64 lines to ≤76 characters (RFC 2045 §6.8)", () => {
        const longHtml = "<p>" + "x".repeat(2000) + "</p>";
        const msg = buildRawMimeMessage({
          from: "LangWatch <contact@langwatch.ai>",
          to: ["user@example.com"],
          subject: "Test",
          html: longHtml,
          attachments: [],
        });

        const lines = msg.split("\r\n");
        // Every line in the message must be ≤998 chars (RFC 5322 hard limit)
        for (const line of lines) {
          expect(line.length).toBeLessThanOrEqual(998);
        }

        // Base64 body lines should be ≤76 chars
        const bodyStart = msg.indexOf(
          "\r\n\r\n",
          msg.indexOf("Content-Transfer-Encoding: base64"),
        );
        const bodySection = msg.slice(bodyStart + 4);
        const bodyLines = bodySection
          .split("\r\n")
          .filter((l) => l.length > 0 && !l.startsWith("----=_Part_"));
        for (const line of bodyLines) {
          expect(line.length).toBeLessThanOrEqual(76);
        }
      });
    });
  });

  describe("given custom headers", () => {
    describe("when building the MIME message", () => {
      it("places custom headers before the blank-line body separator", () => {
        const msg = buildRawMimeMessage({
          from: "LangWatch <contact@langwatch.ai>",
          to: ["user@example.com"],
          subject: "Test",
          html: "<p>Hello</p>",
          headers: {
            "List-Unsubscribe": "<https://example.com/unsub?token=abc>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          attachments: [],
        });

        // The blank line between header block and body
        const separatorIdx = msg.indexOf("\r\n\r\n");
        const headerBlock = msg.slice(0, separatorIdx);

        expect(headerBlock).toContain("List-Unsubscribe:");
        expect(headerBlock).toContain("List-Unsubscribe-Post:");
      });

      it("strips CRLF from custom header names and values", () => {
        const msg = buildRawMimeMessage({
          from: "LangWatch <contact@langwatch.ai>",
          to: ["user@example.com"],
          subject: "Test",
          html: "<p>ok</p>",
          headers: {
            "X-Evil\r\nInjected": "value",
            "X-Clean": "val\r\nue",
          },
          attachments: [],
        });

        const separatorIdx = msg.indexOf("\r\n\r\n");
        const headerBlock = msg.slice(0, separatorIdx);

        // The injected CRLF must be collapsed to a space
        expect(headerBlock).not.toContain("X-Evil\r\nInjected");
        expect(headerBlock).toContain("X-Evil Injected");
        expect(headerBlock).not.toContain("val\r\nue");
      });
    });
  });
});

// ── sendEmail (SES raw path) ──────────────────────────────────────────────────

describe("sendEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sesClientSendMock.mockResolvedValue({ MessageId: "mock-id-123" });
  });

  describe("given non-empty custom headers", () => {
    describe("when sending via SES", () => {
      it("selects SendRawEmailCommand over SendEmailCommand", async () => {
        await sendEmail({
          to: "user@example.com",
          subject: "Test",
          html: "<p>Hello</p>",
          headers: { "List-Unsubscribe": "<https://example.com/unsub>" },
        });

        const call = sesClientSendMock.mock.calls[0];
        const cmd = call![0] as { type: string };
        expect(cmd.type).toBe("SendRawEmailCommand");
      });

      it("encodes a Unicode subject in the raw MIME message", async () => {
        await sendEmail({
          to: "user@example.com",
          subject: "Héllo — ☕ alert",
          html: "<p>Hello</p>",
          headers: { "List-Unsubscribe": "<https://example.com/unsub>" },
        });

        const raw = capturedRawMessage();
        const subjectLine = raw
          .split("\r\n")
          .find((l) => l.startsWith("Subject:"));
        expect(subjectLine).toBeDefined();
        expect(subjectLine).toMatch(/=\?UTF-8\?B\?/);
      });

      it("base64-encodes the HTML body so no 8-bit bytes appear raw", async () => {
        await sendEmail({
          to: "user@example.com",
          subject: "Test",
          html: "<p>café ☕</p>",
          headers: { "List-Unsubscribe": "<https://example.com/unsub>" },
        });

        const raw = capturedRawMessage();
        expect(raw).toContain("Content-Transfer-Encoding: base64");
        // No raw non-ASCII bytes in the encoded message
        expect(raw).not.toMatch(/[\x80-\xFF]/);
      });

      it("keeps all lines within the RFC 5322 998-char hard limit", async () => {
        const longHtml = "<p>" + "Unicode: café ☕ ".repeat(200) + "</p>";
        await sendEmail({
          to: "user@example.com",
          subject: "☕ ".repeat(30),
          html: longHtml,
          headers: { "List-Unsubscribe": "<https://example.com/unsub>" },
        });

        const raw = capturedRawMessage();
        const lines = raw.split("\r\n");
        for (const line of lines) {
          expect(line.length).toBeLessThanOrEqual(998);
        }
      });

      it("places custom headers before the blank-line body separator in the raw message", async () => {
        await sendEmail({
          to: "user@example.com",
          subject: "Test",
          html: "<p>Hello</p>",
          headers: {
            "List-Unsubscribe": "<https://example.com/unsub?token=xyz>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });

        const raw = capturedRawMessage();
        const separatorIdx = raw.indexOf("\r\n\r\n");
        const headerBlock = raw.slice(0, separatorIdx);

        expect(headerBlock).toContain("List-Unsubscribe:");
        expect(headerBlock).toContain("List-Unsubscribe-Post:");
      });
    });
  });

  describe("given BCC recipients on the raw-MIME path", () => {
    describe("when sending via SES with custom headers", () => {
      it("never writes a Bcc: header line or any bcc address into the header block", async () => {
        // Custom headers force the SendRawEmail path. BCC recipients must be
        // delivered via the envelope `Destinations`, NOT rendered into the MIME
        // headers — otherwise every recipient could read the others off the
        // Bcc line. This is the core recipient-privacy guarantee.
        await sendEmail({
          to: "no-reply@langwatch.ai",
          bcc: ["a@x.com"],
          subject: "Test",
          html: "<p>Hello</p>",
          headers: { "List-Unsubscribe": "<https://example.com/unsub>" },
        });

        const raw = capturedRawMessage();
        const separatorIdx = raw.indexOf("\r\n\r\n");
        const headerBlock = raw.slice(0, separatorIdx);

        // No Bcc: header line at all, and the bcc address appears nowhere in
        // the header block (To/From/Subject/custom headers).
        expect(headerBlock).not.toMatch(/^Bcc:/im);
        expect(headerBlock).not.toContain("a@x.com");
      });

      it("still delivers the bcc address via the envelope Destinations", async () => {
        await sendEmail({
          to: "no-reply@langwatch.ai",
          bcc: ["a@x.com"],
          subject: "Test",
          html: "<p>Hello</p>",
          headers: { "List-Unsubscribe": "<https://example.com/unsub>" },
        });

        const cmd = sesClientSendMock.mock.calls[0]![0] as {
          input: { Destinations: string[] };
        };
        expect(cmd.input.Destinations).toContain("a@x.com");
        expect(cmd.input.Destinations).toContain("no-reply@langwatch.ai");
      });
    });
  });

  describe("given empty headers", () => {
    describe("when sending via SES", () => {
      it("uses SendEmailCommand (not raw)", async () => {
        await sendEmail({
          to: "user@example.com",
          subject: "Plain email",
          html: "<p>Hello</p>",
        });

        const call = sesClientSendMock.mock.calls[0];
        const cmd = call![0] as { type: string };
        expect(cmd.type).toBe("SendEmailCommand");
      });
    });
  });

  describe("given a SendGrid path with custom headers", () => {
    // SendGrid path strips CRLF via sanitizeHeaderValue — ensure the contract
    // is not broken by import-time side-effects of our new exports
    it("the module exports remain intact after our additions", () => {
      expect(typeof sendEmail).toBe("function");
      expect(typeof buildRawMimeMessage).toBe("function");
      expect(typeof rfc2047EncodeHeader).toBe("function");
    });
  });
});
