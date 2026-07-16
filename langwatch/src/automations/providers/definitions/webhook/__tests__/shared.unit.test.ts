import { describe, expect, it } from "vitest";
import {
  redactHeadersForLog,
  sanitizeWebhookHeaders,
  validateWebhookUrlShape,
  WEBHOOK_HEADER_VALUE_KEPT,
  webhookActionParamsSchema,
} from "../shared";

describe("redactHeadersForLog", () => {
  it("masks every header value but keeps their names", () => {
    expect(
      redactHeadersForLog({
        Authorization: "Bearer sk-123",
        "X-Api-Key": "k",
        "X-Signature": "abc",
        "X-Trace-Id": "t1",
        Accept: "application/json",
      }),
    ).toEqual({
      Authorization: "***",
      "X-Api-Key": "***",
      "X-Signature": "***",
      "X-Trace-Id": "***",
      Accept: "***",
    });
  });

  it("masks a credential whose name no heuristic would catch", () => {
    // A header name cannot establish whether its value is secret: every
    // configured value is treated as one (ADR-040 §6).
    expect(redactHeadersForLog({ "X-Partner-Key": "super-secret" })).toEqual({
      "X-Partner-Key": "***",
    });
  });
});

describe("validateWebhookUrlShape", () => {
  describe("when the URL is a plain https endpoint", () => {
    it("accepts it", () => {
      expect(
        validateWebhookUrlShape("https://example.com/hooks/langwatch"),
      ).toBeNull();
      expect(validateWebhookUrlShape("https://example.com:443/x")).toBeNull();
    });
  });

  describe("when the URL is not https", () => {
    it("rejects http", () => {
      expect(validateWebhookUrlShape("http://example.com/x")).toMatch(/https/);
    });
    it("rejects non-http schemes", () => {
      expect(validateWebhookUrlShape("ftp://example.com/x")).not.toBeNull();
    });
    it("rejects garbage", () => {
      expect(validateWebhookUrlShape("not a url")).not.toBeNull();
    });
  });

  describe("when the URL carries a non-default port", () => {
    it("rejects it", () => {
      expect(validateWebhookUrlShape("https://example.com:8443/x")).toMatch(
        /port/,
      );
      expect(validateWebhookUrlShape("https://example.com:6379/x")).toMatch(
        /port/,
      );
    });
  });

  describe("when the URL carries userinfo credentials", () => {
    it("rejects it", () => {
      expect(
        validateWebhookUrlShape("https://user:pass@example.com/x"),
      ).toMatch(/credentials/);
    });
  });
});

describe("sanitizeWebhookHeaders", () => {
  describe("when headers include reserved names", () => {
    it("strips connection-shape and LangWatch-injected headers", () => {
      expect(
        sanitizeWebhookHeaders({
          Host: "evil.com",
          "Content-Length": "0",
          "content-type": "text/plain",
          "X-LangWatch-Test-Fire": "false",
          "x-langwatch-signature": "forged",
          Authorization: "Bearer token",
        }),
      ).toEqual({ Authorization: "Bearer token" });
    });
  });

  describe("when header values carry CR/LF", () => {
    it("collapses them so a value cannot smuggle a second header", () => {
      expect(
        sanitizeWebhookHeaders({ "X-Custom": "a\r\nX-Smuggled: b" }),
      ).toEqual({ "X-Custom": "a X-Smuggled: b" });
    });
  });

  describe("when entries are empty", () => {
    it("drops blank names and blank values", () => {
      expect(sanitizeWebhookHeaders({ "": "x", "X-Empty": "  " })).toEqual({});
    });
  });

  describe("when a value carries the kept sentinel", () => {
    it("passes it through for the persist layer to resolve", () => {
      expect(
        sanitizeWebhookHeaders({ Authorization: WEBHOOK_HEADER_VALUE_KEPT }),
      ).toEqual({ Authorization: WEBHOOK_HEADER_VALUE_KEPT });
    });
  });
});

describe("webhookActionParamsSchema", () => {
  describe("when given a complete config", () => {
    it("parses and sanitizes", () => {
      const parsed = webhookActionParamsSchema.parse({
        url: "https://example.com/hook",
        method: "PUT",
        headers: { Authorization: "Bearer x", Host: "evil" },
        bodyTemplate: "{}",
      });
      expect(parsed).toEqual({
        url: "https://example.com/hook",
        method: "PUT",
        headers: { Authorization: "Bearer x" },
        bodyTemplate: "{}",
      });
    });
  });

  describe("when fields are omitted", () => {
    it("defaults method, headers, and bodyTemplate", () => {
      const parsed = webhookActionParamsSchema.parse({
        url: "https://example.com/hook",
      });
      expect(parsed.method).toBe("POST");
      expect(parsed.headers).toEqual({});
      expect(parsed.bodyTemplate).toBeNull();
    });
  });

  describe("when the URL is invalid", () => {
    it("rejects http URLs", () => {
      expect(
        webhookActionParamsSchema.safeParse({ url: "http://example.com" })
          .success,
      ).toBe(false);
    });
    it("rejects a missing URL", () => {
      expect(webhookActionParamsSchema.safeParse({}).success).toBe(false);
    });
  });
});
