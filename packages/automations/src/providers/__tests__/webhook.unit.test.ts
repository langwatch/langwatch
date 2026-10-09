import { describe, expect, it } from "vitest";
import {
  isJsonWebhookContentType,
  sanitizeWebhookHeaders,
  validateWebhookContentType,
  validateWebhookUrlShape,
  WEBHOOK_HEADER_VALUE_KEPT,
  webhookActionParamsSchema,
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
        contentType: "application/json",
      });
    });
  });

  describe("when fields are omitted", () => {
    it("defaults method, headers, bodyTemplate, and contentType", () => {
      const parsed = webhookActionParamsSchema.parse({
        url: "https://example.com/hook",
      });
      expect(parsed.method).toBe("POST");
      expect(parsed.headers).toEqual({});
      expect(parsed.bodyTemplate).toBeNull();
      // Every automation saved before the field existed sent JSON, so the
      // absent value has to keep meaning exactly that.
      expect(parsed.contentType).toBe("application/json");
    });
  });

  describe("when the config declares its own Content-Type", () => {
    it("keeps it through a parse round-trip", () => {
      const parsed = webhookActionParamsSchema.parse({
        url: "https://example.com/hook",
        contentType: "text/plain; charset=utf-8",
        bodyTemplate: "Alert: {{ trigger.name }}",
      });

      expect(parsed.contentType).toBe("text/plain; charset=utf-8");
      expect(webhookActionParamsSchema.parse(parsed).contentType).toBe(
        "text/plain; charset=utf-8",
      );
    });

    it("treats an empty value as the JSON default", () => {
      const parsed = webhookActionParamsSchema.parse({
        url: "https://example.com/hook",
        contentType: "  ",
      });
      expect(parsed.contentType).toBe("application/json");
    });

    it("refuses a value that is not a media type", () => {
      expect(() =>
        webhookActionParamsSchema.parse({
          url: "https://example.com/hook",
          contentType: "not a media type",
        }),
      ).toThrow();
      // A CR/LF can never survive into a header value.
      expect(
        webhookActionParamsSchema.safeParse({
          url: "https://example.com/hook",
          contentType: "text/plain\r\nX-Injected: evil",
        }).success,
      ).toBe(false);
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

describe("isJsonWebhookContentType", () => {
  describe("when the type is JSON or a +json structured suffix", () => {
    it("gets the checked JSON treatment", () => {
      expect(isJsonWebhookContentType("application/json")).toBe(true);
      expect(isJsonWebhookContentType("application/json; charset=utf-8")).toBe(
        true,
      );
      expect(isJsonWebhookContentType("Application/JSON")).toBe(true);
      expect(isJsonWebhookContentType("application/problem+json")).toBe(true);
    });
  });

  describe("when the type is anything else", () => {
    it("sends the render verbatim", () => {
      expect(isJsonWebhookContentType("text/plain")).toBe(false);
      expect(isJsonWebhookContentType("application/xml")).toBe(false);
      expect(isJsonWebhookContentType("text/plain; charset=utf-8")).toBe(false);
    });
  });
});

describe("validateWebhookContentType", () => {
  describe("when the value is a media type", () => {
    it("accepts it, parameters included", () => {
      expect(validateWebhookContentType("application/json")).toBeNull();
      expect(
        validateWebhookContentType("text/plain; charset=utf-8"),
      ).toBeNull();
      expect(validateWebhookContentType("application/soap+xml")).toBeNull();
    });
  });

  describe("when the value is not a media type", () => {
    it("names what is expected", () => {
      expect(validateWebhookContentType("json")).toMatch(/media type/);
      expect(validateWebhookContentType("")).toMatch(/media type/);
      expect(validateWebhookContentType("a/b\r\nX-Evil: 1")).toMatch(
        /media type/,
      );
    });
  });
});
