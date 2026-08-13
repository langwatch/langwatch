import { describe, expect, it } from "vitest";
import {
  sanitizeWebhookHeaders,
  validateWebhookUrlShape,
  WEBHOOK_HEADER_VALUE_KEPT,
  webhookActionParamsSchema,
  webhookContentTypeFor,
} from "../webhook";

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

  describe("when header names carry CR/LF or other non-token characters", () => {
    it("drops the entry so a name cannot smuggle a second header", () => {
      expect(
        sanitizeWebhookHeaders({ "X-Custom\r\nX-Injected: evil": "value" }),
      ).toEqual({});
    });

    it("drops a name with spaces or colons rather than sending an invalid token", () => {
      expect(sanitizeWebhookHeaders({ "X Bad Name": "v" })).toEqual({});
      expect(sanitizeWebhookHeaders({ "X-Bad:Name": "v" })).toEqual({});
    });

    it("still drops a smuggled name that collapses to a reserved header", () => {
      expect(sanitizeWebhookHeaders({ "Host\r\n": "evil.com" })).toEqual({});
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
        bodyFormat: "json",
      });
    });
  });

  describe("when fields are omitted", () => {
    it("defaults method, headers, bodyTemplate, and bodyFormat", () => {
      const parsed = webhookActionParamsSchema.parse({
        url: "https://example.com/hook",
      });
      expect(parsed.method).toBe("POST");
      expect(parsed.headers).toEqual({});
      expect(parsed.bodyTemplate).toBeNull();
      // Every automation saved before the field existed sent JSON, so the
      // absent value has to keep meaning exactly that.
      expect(parsed.bodyFormat).toBe("json");
    });
  });

  describe("when the config asks for a plain-text body", () => {
    it("keeps the format through a parse round-trip", () => {
      const parsed = webhookActionParamsSchema.parse({
        url: "https://example.com/hook",
        bodyFormat: "text",
        bodyTemplate: "Alert: {{ trigger.name }}",
      });

      expect(parsed.bodyFormat).toBe("text");
      expect(webhookActionParamsSchema.parse(parsed).bodyFormat).toBe("text");
    });

    it("refuses a format nothing knows how to send", () => {
      expect(() =>
        webhookActionParamsSchema.parse({
          url: "https://example.com/hook",
          bodyFormat: "xml",
        }),
      ).toThrow();
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

describe("webhookContentTypeFor", () => {
  describe("when the body is JSON", () => {
    it("announces it as application/json", () => {
      expect(webhookContentTypeFor("json")).toBe("application/json");
    });
  });

  describe("when the body is plain text", () => {
    // text/plain with no charset is read as US-ASCII by a strict receiver, so
    // the charset is what keeps an accented character from arriving as
    // mojibake. JSON needs no such statement — it is UTF-8 by definition.
    it("announces it as text/plain in UTF-8", () => {
      expect(webhookContentTypeFor("text")).toBe("text/plain; charset=utf-8");
    });
  });
});
