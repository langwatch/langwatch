import { describe, expect, it } from "vitest";

import { ATTR_KEYS } from "../_constants";
import { LangWatchExtractor } from "../langwatch";
import { createExtractorContext } from "./_testHelpers";

describe("LangWatchExtractor", () => {
  const extractor = new LangWatchExtractor();

  describe("metadata JSON promotion", () => {
    describe("when metadata JSON contains user_id", () => {
      it("promotes to langwatch.user.id via setAttrIfAbsent", () => {
        const ctx = createExtractorContext({
          metadata: JSON.stringify({ user_id: "meta-user-1" }),
        });

        extractor.apply(ctx);

        expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
          ATTR_KEYS.LANGWATCH_USER_ID,
          "meta-user-1",
        );
        expect(ctx.out[ATTR_KEYS.LANGWATCH_USER_ID]).toBe("meta-user-1");
      });
    });

    describe("when metadata JSON contains userId (camelCase)", () => {
      it("promotes to langwatch.user.id via setAttrIfAbsent", () => {
        const ctx = createExtractorContext({
          metadata: JSON.stringify({ userId: "meta-user-camel" }),
        });

        extractor.apply(ctx);

        expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
          ATTR_KEYS.LANGWATCH_USER_ID,
          "meta-user-camel",
        );
        expect(ctx.out[ATTR_KEYS.LANGWATCH_USER_ID]).toBe("meta-user-camel");
      });
    });

    describe("when langwatch.user.id is already set in out", () => {
      it("does not overwrite the existing value", () => {
        const ctx = createExtractorContext({
          metadata: JSON.stringify({ user_id: "meta-user" }),
        });
        // Pre-set via explicit attribute processing (simulated)
        ctx.out[ATTR_KEYS.LANGWATCH_USER_ID] = "explicit-user";

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.LANGWATCH_USER_ID]).toBe("explicit-user");
      });
    });

    describe("when metadata contains thread_id", () => {
      it("promotes to gen_ai.conversation.id", () => {
        const ctx = createExtractorContext({
          metadata: JSON.stringify({ thread_id: "thread-abc" }),
        });

        extractor.apply(ctx);

        expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
          ATTR_KEYS.GEN_AI_CONVERSATION_ID,
          "thread-abc",
        );
        expect(ctx.out[ATTR_KEYS.GEN_AI_CONVERSATION_ID]).toBe("thread-abc");
      });
    });

    describe("when metadata contains customer_id", () => {
      it("promotes to langwatch.customer.id", () => {
        const ctx = createExtractorContext({
          metadata: JSON.stringify({ customer_id: "cust-xyz" }),
        });

        extractor.apply(ctx);

        expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
          ATTR_KEYS.LANGWATCH_CUSTOMER_ID,
          "cust-xyz",
        );
        expect(ctx.out[ATTR_KEYS.LANGWATCH_CUSTOMER_ID]).toBe("cust-xyz");
      });
    });

    describe("when metadata is invalid JSON", () => {
      it("does not throw", () => {
        const ctx = createExtractorContext({
          metadata: "{not valid json",
        });

        expect(() => extractor.apply(ctx)).not.toThrow();
      });

      it("does not set any promoted attributes", () => {
        const ctx = createExtractorContext({
          metadata: "{not valid json",
        });

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.LANGWATCH_USER_ID]).toBeUndefined();
        expect(ctx.out[ATTR_KEYS.GEN_AI_CONVERSATION_ID]).toBeUndefined();
        expect(ctx.out[ATTR_KEYS.LANGWATCH_CUSTOMER_ID]).toBeUndefined();
      });
    });
  });

  describe("evaluation events (langwatch.evaluation.custom)", () => {
    describe("when span has a langwatch.evaluation.custom event", () => {
      it("sets langwatch.reserved.evaluations attribute with evaluation data", () => {
        const evalPayload = {
          evaluation_id: "eval_abc123",
          name: "toxicity",
          score: 0.95,
          passed: true,
          label: "safe",
        };
        const ctx = createExtractorContext({}, undefined, [
          {
            name: "langwatch.evaluation.custom",
            timeUnixMs: Date.now(),
            attributes: {
              json_encoded_event: JSON.stringify(evalPayload),
            },
          },
        ]);

        extractor.apply(ctx);

        expect(ctx.setAttr).toHaveBeenCalledWith(
          ATTR_KEYS.LANGWATCH_RESERVED_EVALUATIONS,
          expect.any(String),
        );
        const evaluations = JSON.parse(
          ctx.out[ATTR_KEYS.LANGWATCH_RESERVED_EVALUATIONS] as string,
        );
        expect(evaluations).toHaveLength(1);
        expect(evaluations[0]).toMatchObject({
          evaluation_id: "eval_abc123",
          name: "toxicity",
          score: 0.95,
          passed: true,
          label: "safe",
        });
      });

      it("maps first evaluation to GenAI semconv attributes", () => {
        const evalPayload = {
          name: "toxicity",
          score: 0.95,
          label: "safe",
        };
        const ctx = createExtractorContext({}, undefined, [
          {
            name: "langwatch.evaluation.custom",
            timeUnixMs: Date.now(),
            attributes: {
              json_encoded_event: JSON.stringify(evalPayload),
            },
          },
        ]);

        extractor.apply(ctx);

        expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
          ATTR_KEYS.GEN_AI_EVALUATION_NAME,
          "toxicity",
        );
        expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
          ATTR_KEYS.GEN_AI_EVALUATION_SCORE_VALUE,
          0.95,
        );
        expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
          ATTR_KEYS.GEN_AI_EVALUATION_SCORE_LABEL,
          "safe",
        );
      });
    });

    describe("when span has multiple evaluation events", () => {
      it("includes all evaluations in the reserved attribute", () => {
        const ctx = createExtractorContext({}, undefined, [
          {
            name: "langwatch.evaluation.custom",
            timeUnixMs: Date.now(),
            attributes: {
              json_encoded_event: JSON.stringify({ name: "toxicity", score: 0.9 }),
            },
          },
          {
            name: "langwatch.evaluation.custom",
            timeUnixMs: Date.now(),
            attributes: {
              json_encoded_event: JSON.stringify({ name: "relevance", score: 0.8 }),
            },
          },
        ]);

        extractor.apply(ctx);

        const evaluations = JSON.parse(
          ctx.out[ATTR_KEYS.LANGWATCH_RESERVED_EVALUATIONS] as string,
        );
        expect(evaluations).toHaveLength(2);
        expect(evaluations[0].name).toBe("toxicity");
        expect(evaluations[1].name).toBe("relevance");
      });
    });

    describe("when span has no evaluation events", () => {
      it("does not set langwatch.reserved.evaluations", () => {
        const ctx = createExtractorContext({});

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.LANGWATCH_RESERVED_EVALUATIONS]).toBeUndefined();
      });
    });

    describe("when event has invalid json_encoded_event", () => {
      it("skips the malformed event without throwing", () => {
        const ctx = createExtractorContext({}, undefined, [
          {
            name: "langwatch.evaluation.custom",
            timeUnixMs: Date.now(),
            attributes: {
              json_encoded_event: "{not valid json",
            },
          },
        ]);

        expect(() => extractor.apply(ctx)).not.toThrow();
        expect(ctx.out[ATTR_KEYS.LANGWATCH_RESERVED_EVALUATIONS]).toBeUndefined();
      });
    });
  });
});
