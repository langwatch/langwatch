import { describe, expect, it } from "vitest";
import { CONTENT_CATEGORIES } from "../data-privacy";
import { CHAT_ARRAY_KEYS, CONTENT_KEY_CATALOG } from "../data-privacy.content-catalog";
import {
  DROPPED_ATTRIBUTES_MARKER_MAX_KEYS,
  PRIVACY_DROPPED_ATTRIBUTES_MARKER_ATTR,
  PRIVACY_DROPPED_MARKER_ATTR,
} from "../data-privacy.markers";

/**
 * Spec: packages/features/data-privacy/specs/span-content-drop.feature
 *
 * TWIN PIN, by literal. The application's copy is
 * `platform/app/src/server/data-privacy/dropKeyCatalog.ts` and both graphs
 * ingest, so the two must agree key for key. Reading the application's file
 * here would tie this suite to a path that is being deleted; writing the keys
 * out is what survives the move.
 *
 * A key MISSING from a list is the whole failure: the customer set the category
 * to `drop`, the key was never stripped, and the content is in ClickHouse.
 * Nothing about a stored span records which keys were considered, so a span
 * scanned against nine input keys and a span scanned against ten are the same
 * row.
 */

describe("CONTENT_KEY_CATALOG", () => {
  describe("given the four content categories", () => {
    describe("when the catalog is read", () => {
      /** @scenario "The drop catalog is pinned key for key" */
      it("holds exactly these keys, in this order", () => {
        expect(CONTENT_KEY_CATALOG).toEqual({
          input: [
            "gen_ai.input.messages",
            "gen_ai.prompt",
            "ai.prompt",
            "ai.prompt.messages",
            "llm.input_messages",
            "langwatch.input",
            "input",
            "input.value",
            "raw_input",
            "traceloop.entity.input",
          ],
          output: [
            "gen_ai.output.messages",
            "gen_ai.completion",
            "gen_ai.response.choices",
            "gen_ai.response.finish_reasons",
            "ai.response",
            "ai.response.text",
            "ai.response.object",
            "llm.output_messages",
            "langwatch.output",
            "output",
            "output.value",
            "traceloop.entity.output",
          ],
          system: ["gen_ai.system_instructions"],
          tools: [
            "gen_ai.tool.call.arguments",
            "gen_ai.tool.call.result",
            "ai.toolCall",
            "ai.toolCall.args",
          ],
        });
      });

      /** @scenario "Every content category has a key set" */
      it("covers all four categories", () => {
        expect(Object.keys(CONTENT_KEY_CATALOG).sort()).toEqual([...CONTENT_CATEGORIES].sort());
      });

      /**
       * @scenario "Metadata keys are never droppable"
       *
       * Tokens, cost, model, latency, ids, names and status have to survive a
       * drop: a project that stops storing prompts still gets its dashboards.
       */
      it("names no metadata key", () => {
        const all = CONTENT_CATEGORIES.flatMap((category) => CONTENT_KEY_CATALOG[category]);
        for (const key of [
          "gen_ai.usage.input_tokens",
          "gen_ai.usage.output_tokens",
          "gen_ai.request.model",
          "gen_ai.response.model",
          "langwatch.span.cost",
          "langwatch.span.type",
        ]) {
          expect(all).not.toContain(key);
        }
      });
    });
  });

  describe("given the chat-array keys", () => {
    describe("when a role strip walks a span", () => {
      /**
       * @scenario "The chat-array keys are exactly input plus output"
       *
       * A system turn inside a conversation survives dropping
       * `gen_ai.system_instructions`, and canonicalisation re-derives the
       * attribute from it afterwards. The role strip only walks these keys, so
       * a key missing here is a conversation whose system turns are stored.
       */
      it("is the union of the input and output key sets", () => {
        expect([...CHAT_ARRAY_KEYS].sort()).toEqual(
          [...CONTENT_KEY_CATALOG.input, ...CONTENT_KEY_CATALOG.output].sort(),
        );
        expect(CHAT_ARRAY_KEYS.has("gen_ai.system_instructions")).toBe(false);
        expect(CHAT_ARRAY_KEYS.has("gen_ai.tool.call.arguments")).toBe(false);
      });
    });
  });
});

describe("the drop markers", () => {
  describe("given a span the drop pass touched", () => {
    describe("when a reader looks for the evidence", () => {
      /**
       * @scenario "The drop markers are a wire format"
       *
       * A marker is the ONLY trace of a pass that ran: the original span is
       * never stored. The attribute name is therefore a contract between the
       * process that wrote the span and every reader of it, and a differently
       * spelled key presents dropped content as content that was never sent.
       */
      it("spells the two marker keys and the key cap exactly", () => {
        expect(PRIVACY_DROPPED_MARKER_ATTR).toBe("langwatch.privacy.dropped");
        expect(PRIVACY_DROPPED_ATTRIBUTES_MARKER_ATTR).toBe("langwatch.privacy.dropped_attributes");
        expect(DROPPED_ATTRIBUTES_MARKER_MAX_KEYS).toBe(20);
      });
    });
  });
});
