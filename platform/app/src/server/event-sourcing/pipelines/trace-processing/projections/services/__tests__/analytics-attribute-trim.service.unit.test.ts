import { describe, expect, it } from "vitest";
import {
  ANALYTICS_METADATA_VALUE_CAP,
  ANALYTICS_STANDARD_VALUE_CAP,
  ANALYTICS_TRUNCATION_ELLIPSIS,
  trimAttributesForAnalytics,
} from "../analytics-attribute-trim.service";

describe("trimAttributesForAnalytics", () => {
  describe("given a metadata.* attribute", () => {
    describe("when the value is within the 4 KiB cap", () => {
      it("keeps it verbatim", () => {
        const out = trimAttributesForAnalytics({
          "metadata.tenant_tier": "enterprise",
        });
        expect(out["metadata.tenant_tier"]).toBe("enterprise");
      });
    });

    describe("when the value exceeds the 4 KiB cap", () => {
      it("truncates to the cap and appends an ellipsis", () => {
        const oversize = "x".repeat(ANALYTICS_METADATA_VALUE_CAP + 200);
        const out = trimAttributesForAnalytics({
          "metadata.giant_json": oversize,
        });
        const expected =
          "x".repeat(ANALYTICS_METADATA_VALUE_CAP) +
          ANALYTICS_TRUNCATION_ELLIPSIS;
        expect(out["metadata.giant_json"]).toBe(expected);
      });
    });

    describe("when there are several metadata keys mixing under-cap and over-cap", () => {
      it("preserves all keys, truncating only the ones past the cap", () => {
        const out = trimAttributesForAnalytics({
          "metadata.short": "short-value",
          "metadata.long": "y".repeat(ANALYTICS_METADATA_VALUE_CAP + 1),
        });
        expect(Object.keys(out).sort()).toEqual([
          "metadata.long",
          "metadata.short",
        ]);
        expect(out["metadata.short"]).toBe("short-value");
        expect((out["metadata.long"] ?? "").length).toBe(
          ANALYTICS_METADATA_VALUE_CAP + ANALYTICS_TRUNCATION_ELLIPSIS.length,
        );
      });
    });
  });

  describe("given a langwatch.reserved.* attribute", () => {
    describe("when the value is short", () => {
      it("keeps it verbatim", () => {
        const out = trimAttributesForAnalytics({
          "langwatch.reserved.output_source": "explicit",
        });
        expect(out["langwatch.reserved.output_source"]).toBe("explicit");
      });
    });

    describe("when the value is past the standard 256-char cap but under the 4 KiB cap", () => {
      it("keeps it verbatim (reserved is past the standard cap but still under the metadata cap)", () => {
        const longSum = "9".repeat(ANALYTICS_STANDARD_VALUE_CAP + 100);
        const out = trimAttributesForAnalytics({
          "langwatch.reserved.cache_read_tokens": longSum,
        });
        expect(out["langwatch.reserved.cache_read_tokens"]).toBe(longSum);
      });
    });

    describe("when the value exceeds the 4 KiB cap", () => {
      it("truncates to the cap and appends an ellipsis (same as metadata)", () => {
        const oversize = "r".repeat(ANALYTICS_METADATA_VALUE_CAP + 50);
        const out = trimAttributesForAnalytics({
          "langwatch.reserved.unbounded_lift": oversize,
        });
        const expected =
          "r".repeat(ANALYTICS_METADATA_VALUE_CAP) +
          ANALYTICS_TRUNCATION_ELLIPSIS;
        expect(out["langwatch.reserved.unbounded_lift"]).toBe(expected);
      });
    });
  });

  describe("given an arbitrary attribute key", () => {
    describe("when the value is at or under the 256-char cap", () => {
      it("keeps it verbatim", () => {
        const value = "v".repeat(ANALYTICS_STANDARD_VALUE_CAP);
        const out = trimAttributesForAnalytics({
          "gen_ai.agent.name": value,
          "gen_ai.provider.name": "openai",
        });
        expect(out["gen_ai.agent.name"]).toBe(value);
        expect(out["gen_ai.provider.name"]).toBe("openai");
      });
    });

    describe("when the value is past the 256-char cap", () => {
      it("drops the key entirely", () => {
        const oversize = "w".repeat(ANALYTICS_STANDARD_VALUE_CAP + 1);
        const out = trimAttributesForAnalytics({
          "some.unbounded.blob": oversize,
        });
        expect(out["some.unbounded.blob"]).toBeUndefined();
      });
    });
  });

  describe("given a blocklisted attribute key", () => {
    describe("when the value is a short identifier", () => {
      it("still drops the key", () => {
        const out = trimAttributesForAnalytics({
          "gen_ai.prompt": "hi",
        });
        expect(out["gen_ai.prompt"]).toBeUndefined();
      });
    });

    describe("when the value is a large message blob", () => {
      it("drops the key (matches what the analytics scan never wants)", () => {
        const out = trimAttributesForAnalytics({
          "gen_ai.completion": "tokens".repeat(1000),
          "gen_ai.response.choices": "more tokens".repeat(1000),
          "gen_ai.response.finish_reasons": "stop",
        });
        expect(out["gen_ai.completion"]).toBeUndefined();
        expect(out["gen_ai.response.choices"]).toBeUndefined();
        expect(out["gen_ai.response.finish_reasons"]).toBeUndefined();
      });
    });

    describe("when the key has a payload prefix shape (e.g. gen_ai.prompt.0.content)", () => {
      it("drops the prefixed variants too", () => {
        const out = trimAttributesForAnalytics({
          "gen_ai.prompt.0.role": "user",
          "gen_ai.prompt.0.content": "hello",
          "gen_ai.completion.0.role": "assistant",
          "llm.input_messages.0.message.role": "user",
        });
        expect(out["gen_ai.prompt.0.role"]).toBeUndefined();
        expect(out["gen_ai.prompt.0.content"]).toBeUndefined();
        expect(out["gen_ai.completion.0.role"]).toBeUndefined();
        expect(out["llm.input_messages.0.message.role"]).toBeUndefined();
      });
    });
  });

  describe("given a mix of all classes in one map", () => {
    it("keeps metadata + reserved + bounded arbitrary; drops oversize arbitrary + blocklist", () => {
      const out = trimAttributesForAnalytics({
        "metadata.customer_tier": "pro",
        "metadata.huge_blob": "z".repeat(ANALYTICS_METADATA_VALUE_CAP + 100),
        "langwatch.reserved.log_record_count": "42",
        "gen_ai.provider.name": "anthropic",
        "gen_ai.prompt": "anything",
        "some.unbounded.value": "q".repeat(ANALYTICS_STANDARD_VALUE_CAP + 50),
        "langwatch.origin": "application",
        "langwatch.user_id": "user-123",
      });
      expect(Object.keys(out).sort()).toEqual([
        "gen_ai.provider.name",
        "langwatch.origin",
        "langwatch.reserved.log_record_count",
        "langwatch.user_id",
        "metadata.customer_tier",
        "metadata.huge_blob",
      ]);
      expect(out["gen_ai.prompt"]).toBeUndefined();
      expect(out["some.unbounded.value"]).toBeUndefined();
    });
  });

  describe("when the input is empty", () => {
    it("returns an empty map", () => {
      expect(trimAttributesForAnalytics({})).toEqual({});
    });
  });

  describe("when the input has a non-string value (defensive)", () => {
    it("drops the key rather than coercing", () => {
      const out = trimAttributesForAnalytics({
        "metadata.tier": "pro",
        // @ts-expect-error — exercise the runtime guard
        "some.numeric": 42,
      });
      expect(out["metadata.tier"]).toBe("pro");
      expect(out["some.numeric"]).toBeUndefined();
    });
  });
});
