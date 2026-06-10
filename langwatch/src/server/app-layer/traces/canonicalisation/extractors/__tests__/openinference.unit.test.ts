import { describe, expect, it } from "vitest";

import { ATTR_KEYS } from "../_constants";
import { OpenInferenceExtractor } from "../openinference";
import { createExtractorContext } from "./_testHelpers";

describe("OpenInferenceExtractor", () => {
  const extractor = new OpenInferenceExtractor();

  describe("when openinference.span.kind is present", () => {
    it("maps lowercase kind to langwatch.span.type", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_SPAN_KIND]: "LLM",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
    });

    it("takes the attribute from the bag", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_SPAN_KIND]: "LLM",
      });

      extractor.apply(ctx);

      expect(ctx.bag.attrs.has(ATTR_KEYS.OPENINFERENCE_SPAN_KIND)).toBe(false);
    });

    it("records a rule", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_SPAN_KIND]: "LLM",
      });

      extractor.apply(ctx);

      expect(ctx.recordRule).toHaveBeenCalledWith(
        "openinference:openinference.span.kind->langwatch.span.type",
      );
    });
  });

  describe("when langwatch.span.type already set to a valid type", () => {
    it("does not overwrite the existing span type", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.SPAN_TYPE]: "agent",
        [ATTR_KEYS.OPENINFERENCE_SPAN_KIND]: "LLM",
      });

      extractor.apply(ctx);

      // The span type should remain as-is in the bag (not overridden).
      // The extractor does NOT call setAttr for span type when it is already valid.
      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBeUndefined();
    });

    it("still processes user.id", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.SPAN_TYPE]: "agent",
        [ATTR_KEYS.OPENINFERENCE_USER_ID]: "user-123",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_USER_ID]).toBe("user-123");
    });

    it("still processes session.id", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.SPAN_TYPE]: "agent",
        [ATTR_KEYS.OPENINFERENCE_SESSION_ID]: "sess-456",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_CONVERSATION_ID]).toBe("sess-456");
    });

    it("still processes tag.tags", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.SPAN_TYPE]: "agent",
        [ATTR_KEYS.OPENINFERENCE_TAG_TAGS]: "tag-a",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_LABELS]).toBe("tag-a");
    });
  });

  describe("when user.id is present", () => {
    it("maps to langwatch.user.id via setAttrIfAbsent", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_USER_ID]: "user-abc",
      });

      extractor.apply(ctx);

      expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
        ATTR_KEYS.LANGWATCH_USER_ID,
        "user-abc",
      );
      expect(ctx.out[ATTR_KEYS.LANGWATCH_USER_ID]).toBe("user-abc");
    });

    it("records a rule", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_USER_ID]: "user-abc",
      });

      extractor.apply(ctx);

      expect(ctx.recordRule).toHaveBeenCalledWith("openinference:user.id");
    });
  });

  describe("when user.id is an empty string", () => {
    it("does not set langwatch.user.id", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_USER_ID]: "",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_USER_ID]).toBeUndefined();
    });
  });

  describe("when langwatch.user.id is already set in out", () => {
    it("does not overwrite the existing value", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_USER_ID]: "openinference-user",
      });
      // Pre-set the output attribute
      ctx.out[ATTR_KEYS.LANGWATCH_USER_ID] = "existing-user";

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_USER_ID]).toBe("existing-user");
    });
  });

  describe("when session.id is present", () => {
    it("maps to gen_ai.conversation.id via setAttrIfAbsent", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_SESSION_ID]: "sess-xyz",
      });

      extractor.apply(ctx);

      expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
        ATTR_KEYS.GEN_AI_CONVERSATION_ID,
        "sess-xyz",
      );
      expect(ctx.out[ATTR_KEYS.GEN_AI_CONVERSATION_ID]).toBe("sess-xyz");
    });
  });

  describe("when gen_ai.conversation.id is already set", () => {
    it("does not overwrite the existing value", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_SESSION_ID]: "new-session",
      });
      ctx.out[ATTR_KEYS.GEN_AI_CONVERSATION_ID] = "existing-thread";

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_CONVERSATION_ID]).toBe("existing-thread");
    });
  });

  describe("when tag.tags is a string", () => {
    it("sets langwatch.labels to the string value", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_TAG_TAGS]: "my-tag",
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_LABELS]).toBe("my-tag");
    });
  });

  describe("when tag.tags is an array", () => {
    it("JSON-stringifies and sets langwatch.labels", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_TAG_TAGS]: ["tag-a", "tag-b"],
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_LABELS]).toBe(
        JSON.stringify(["tag-a", "tag-b"]),
      );
    });
  });

  describe("when llm.token_count.* attributes are present", () => {
    it("maps prompt/completion counts to canonical gen_ai.usage.*", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT]: 751,
        [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_COMPLETION]: 94,
        [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_TOTAL]: 845,
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(751);
      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(94);
    });

    it("maps reasoning + cache_read + cache_write to canonical keys", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_COMPLETION_DETAILS_REASONING]:
          12,
        [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_READ]:
          120,
        [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_WRITE]:
          30,
      });

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_REASONING_TOKENS]).toBe(12);
      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]).toBe(120);
      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS]).toBe(
        30,
      );
    });

    it("consumes all llm.token_count.* keys so they don't leak into params", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT]: 751,
        [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_COMPLETION]: 94,
        [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_TOTAL]: 845,
        [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_COMPLETION_DETAILS_REASONING]:
          12,
        [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_READ]:
          120,
        [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_WRITE]:
          30,
      });

      extractor.apply(ctx);

      const remaining = [
        ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT,
        ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_COMPLETION,
        ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_TOTAL,
        ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_COMPLETION_DETAILS_REASONING,
        ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_READ,
        ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT_DETAILS_CACHE_WRITE,
      ];
      for (const key of remaining) {
        expect(ctx.bag.attrs.has(key)).toBe(false);
      }
    });

    it("records a rule when any token-count attribute is present", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT]: 10,
      });

      extractor.apply(ctx);

      expect(ctx.recordRule).toHaveBeenCalledWith(
        "openinference:llm.token_count",
      );
    });

    it("does not overwrite a canonical token already set by gen_ai.usage.*", () => {
      const ctx = createExtractorContext({
        [ATTR_KEYS.OPENINFERENCE_LLM_TOKEN_COUNT_PROMPT]: 999,
      });
      ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS] = 42;

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(42);
    });
  });
});
