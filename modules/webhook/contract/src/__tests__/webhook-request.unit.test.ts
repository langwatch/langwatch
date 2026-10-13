import { describe, expect, it } from "vitest";

import {
  findWebhookUrlProblemMessage,
  sanitizeWebhookHeaders,
  WEBHOOK_HEADER_VALUE_KEPT,
} from "../webhook-request.ts";

describe("findWebhookUrlProblemMessage", () => {
  describe("when the URL is a plain https endpoint", () => {
    it("accepts it", () => {
      expect(findWebhookUrlProblemMessage("https://example.com/hooks/langwatch")).toBeNull();
      expect(findWebhookUrlProblemMessage("https://example.com:443/x")).toBeNull();
    });
  });

  describe("when the URL is not https", () => {
    it("rejects http", () => {
      expect(findWebhookUrlProblemMessage("http://example.com/x")).toMatch(/https/);
    });
    it("rejects non-http schemes", () => {
      expect(findWebhookUrlProblemMessage("ftp://example.com/x")).not.toBeNull();
    });
    it("rejects garbage", () => {
      expect(findWebhookUrlProblemMessage("not a url")).not.toBeNull();
    });
  });

  describe("when the URL carries a non-default port", () => {
    it("rejects it", () => {
      expect(findWebhookUrlProblemMessage("https://example.com:8443/x")).toMatch(/port/);
      expect(findWebhookUrlProblemMessage("https://example.com:6379/x")).toMatch(/port/);
    });
  });

  describe("when the URL carries userinfo credentials", () => {
    it("rejects it", () => {
      expect(findWebhookUrlProblemMessage("https://user:pass@example.com/x")).toMatch(
        /credentials/,
      );
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
      expect(sanitizeWebhookHeaders({ "X-Custom": "a\r\nX-Smuggled: b" })).toEqual({
        "X-Custom": "a X-Smuggled: b",
      });
    });
  });

  describe("when header names carry CR/LF or other non-token characters", () => {
    it("drops the entry so a name cannot smuggle a second header", () => {
      expect(sanitizeWebhookHeaders({ "X-Custom\r\nX-Injected: evil": "value" })).toEqual({});
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
      expect(sanitizeWebhookHeaders({ Authorization: WEBHOOK_HEADER_VALUE_KEPT })).toEqual({
        Authorization: WEBHOOK_HEADER_VALUE_KEPT,
      });
    });
  });
});
