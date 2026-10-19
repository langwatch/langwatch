import { describe, expect, it } from "vitest";

import {
  isJsonWebhookContentType,
  isWebhookContentType,
  webhookActionParamsSchema,
} from "../webhook.ts";

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
    /** @scenario "An automation saved before content types existed still sends JSON" */
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
      expect(webhookActionParamsSchema.parse(parsed).contentType).toBe("text/plain; charset=utf-8");
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
      ).toThrow(/media type/);
      // A CR/LF can never survive into a header value.
      expect(
        webhookActionParamsSchema.validate({
          url: "https://example.com/hook",
          contentType: "text/plain\r\nX-Injected: evil",
        }),
      ).toBe(false);
    });
  });

  describe("when the URL is invalid", () => {
    it("rejects http URLs", () => {
      expect(webhookActionParamsSchema.validate({ url: "http://example.com" })).toBe(false);
    });
    it("rejects a missing URL", () => {
      expect(webhookActionParamsSchema.validate({})).toBe(false);
    });
  });
});

describe("isJsonWebhookContentType", () => {
  describe("when the type is JSON or a +json structured suffix", () => {
    it("gets the checked JSON treatment", () => {
      expect(isJsonWebhookContentType("application/json")).toBe(true);
      expect(isJsonWebhookContentType("application/json; charset=utf-8")).toBe(true);
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

describe("isWebhookContentType", () => {
  describe("when the value is a media type", () => {
    it("accepts it, parameters included", () => {
      expect(isWebhookContentType("application/json")).toBe(true);
      expect(isWebhookContentType("text/plain; charset=utf-8")).toBe(true);
      expect(isWebhookContentType("application/soap+xml")).toBe(true);
    });
  });

  describe("when the value is not a media type", () => {
    it("refuses it", () => {
      expect(isWebhookContentType("json")).toBe(false);
      expect(isWebhookContentType("")).toBe(false);
      expect(isWebhookContentType("a/b\r\nX-Evil: 1")).toBe(false);
    });
  });
});
