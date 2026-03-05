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

      expect(ctx.out[ATTR_KEYS.GEN_AI_CONVERSATION_ID]).toBe(
        "existing-thread",
      );
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
});
