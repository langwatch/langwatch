/**
 * The Vercel AI SDK flattens `experimental_telemetry.metadata` onto every span
 * it emits as `ai.telemetry.metadata.<key>`. The trace summary read
 * `langwatch.*`, `gen_ai.*` and `tag.tags` only, so a Vercel AI call tagged
 * through the SDK's own metadata channel reached the product with no labels,
 * no user, no conversation and no custom keys.
 */
import { describe, expect, it } from "vitest";
import type { NormalizedSpan } from "@langwatch/trace-contract";

import { TraceAttributeExtractionService } from "../trace-attribute-extraction.service";

function makeService() {
  return TraceAttributeExtractionService.create();
}

function makeSpan(
  overrides: Partial<Pick<NormalizedSpan, "spanAttributes" | "resourceAttributes">> = {},
): NormalizedSpan {
  return {
    spanAttributes: {},
    resourceAttributes: {},
    ...overrides,
  } as NormalizedSpan;
}

describe("TraceAttributeExtractionService.extractAttributes and the Vercel AI SDK metadata channel", () => {
  describe("when a span carries ai.telemetry.metadata.labels", () => {
    /** @scenario Labels passed to experimental_telemetry reach the trace */
    it("folds them into langwatch.labels", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: {
            "ai.telemetry.metadata.labels": ["checkout", "beta"],
          },
        }),
      );
      expect(JSON.parse(result["langwatch.labels"]!)).toEqual(["checkout", "beta"]);
    });

    /** @scenario Vercel labels join labels sent by another span of the same trace */
    it("unions them with langwatch.labels without duplicates", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: {
            "langwatch.labels": ["prod", "checkout"],
            "ai.telemetry.metadata.labels": ["checkout"],
          },
        }),
      );
      expect(JSON.parse(result["langwatch.labels"]!).sort()).toEqual(["checkout", "prod"]);
    });
  });

  describe("when a span carries the identity metadata keys", () => {
    /** @scenario A user id passed to experimental_telemetry identifies the trace */
    it("fills the trace user id", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "ai.telemetry.metadata.user_id": "user-42" },
        }),
      );
      expect(result["langwatch.user_id"]).toBe("user-42");
    });

    /** @scenario A thread id passed to experimental_telemetry groups the conversation */
    it("fills the conversation id", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "ai.telemetry.metadata.thread_id": "thread-9" },
        }),
      );
      expect(result["gen_ai.conversation.id"]).toBe("thread-9");
    });

    /** @scenario A customer id passed to experimental_telemetry reaches the trace */
    it("fills the customer id", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "ai.telemetry.metadata.customer_id": "acme" },
        }),
      );
      expect(result["langwatch.customer_id"]).toBe("acme");
    });

    /** @scenario The camelCase spelling of an identity key is accepted */
    it("accepts the camelCase spelling", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "ai.telemetry.metadata.threadId": "thread-9" },
        }),
      );
      expect(result["gen_ai.conversation.id"]).toBe("thread-9");
    });
  });

  describe("when a span carries a metadata key that is not reserved", () => {
    /** @scenario A key that is not reserved becomes custom trace metadata */
    it("keeps it as custom trace metadata", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "ai.telemetry.metadata.tenant": "eu-west" },
        }),
      );
      expect(result["metadata.tenant"]).toBe("eu-west");
    });

    /** @scenario A non-string value keeps its own shape in custom metadata */
    it("writes a number as its own text", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "ai.telemetry.metadata.retry_count": 3 },
        }),
      );
      expect(result["metadata.retry_count"]).toBe("3");
    });
  });

  describe("when the same value arrives on both channels", () => {
    /** @scenario An explicit LangWatch attribute wins over the Vercel channel */
    it("keeps the explicit LangWatch value", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: {
            "langwatch.user.id": "explicit-user",
            "ai.telemetry.metadata.user_id": "vercel-user",
          },
        }),
      );
      expect(result["langwatch.user_id"]).toBe("explicit-user");
    });

    /** @scenario An explicit custom metadata attribute wins over the Vercel channel */
    it("keeps the explicit custom metadata value", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: {
            "metadata.tenant": "explicit",
            "ai.telemetry.metadata.tenant": "vercel",
          },
        }),
      );
      expect(result["metadata.tenant"]).toBe("explicit");
    });
  });

  describe("when a span carries Vercel telemetry keys that are not metadata", () => {
    /** @scenario The Vercel telemetry keys that are not metadata are left alone */
    it("leaves them out of trace metadata", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: {
            "ai.telemetry.functionId": "checkout-flow",
            "ai.model.id": "gpt-5-mini",
          },
        }),
      );
      expect(result["metadata.functionId"]).toBeUndefined();
      expect(Object.keys(result).filter((key) => key.startsWith("metadata."))).toEqual([]);
    });
  });
});
