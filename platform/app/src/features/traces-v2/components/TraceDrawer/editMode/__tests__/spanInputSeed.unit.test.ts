import { describe, expect, it } from "vitest";
import { buildDisplayInput } from "~/server/tracer/spanIOStringify";
import type { Span } from "~/server/tracer/types";
import { capturedInputForEditing } from "../spanInputSeed";

const MESSAGES = [
  { role: "user", content: "what is the weather" },
  { role: "assistant", content: "mild" },
];

const SYSTEM_PROMPT = "You are a weather assistant.";

/** What the reader's input panel shows: the prompt in front of the messages. */
const displayInput = JSON.stringify([
  { role: "system", content: SYSTEM_PROMPT },
  ...MESSAGES,
]);

describe("given a span whose system prompt is recorded apart from its messages", () => {
  describe("when the input editor is seeded", () => {
    /** @scenario "The system prompt shown with the messages is not edited into them" */
    it("leaves the prompt out of what the reviewer edits", () => {
      const seed = capturedInputForEditing({
        text: displayInput,
        params: { "gen_ai.system_instructions": SYSTEM_PROMPT },
      });

      expect(seed).toBe(JSON.stringify(MESSAGES));
    });

    /** @scenario "The system prompt shown with the messages is not edited into them" */
    it("reads the prompt from nested attributes as well", () => {
      const seed = capturedInputForEditing({
        text: displayInput,
        params: { gen_ai: { system_instructions: SYSTEM_PROMPT } },
      });

      expect(seed).toBe(JSON.stringify(MESSAGES));
    });
  });
});

describe("given a span whose messages carry their own system message", () => {
  describe("when the input editor is seeded", () => {
    /** @scenario "The system prompt shown with the messages is not edited into them" */
    it("keeps every message the trace recorded", () => {
      const recorded = JSON.stringify([
        { role: "system", content: "a different prompt" },
        ...MESSAGES,
      ]);

      const seed = capturedInputForEditing({
        text: recorded,
        params: { "gen_ai.system_instructions": SYSTEM_PROMPT },
      });

      expect(seed).toBe(recorded);
    });
  });
});

describe("given a span whose system prompt is recorded as content blocks", () => {
  const spanWith = (params: Record<string, unknown>) =>
    ({
      input: { type: "chat_messages", value: MESSAGES },
      params,
    }) as unknown as Pick<Span, "input" | "params">;

  const cases: Array<[string, Record<string, unknown>]> = [
    [
      "as an array of content blocks",
      {
        "gen_ai.system_instructions": [
          { type: "text", content: SYSTEM_PROMPT },
        ],
      },
    ],
    [
      "as content blocks under the nested attribute",
      {
        gen_ai: {
          system_instructions: [{ type: "text", content: SYSTEM_PROMPT }],
        },
      },
    ],
    [
      "as a JSON encoded array of content blocks",
      {
        "gen_ai.system_instructions": JSON.stringify([
          { type: "text", content: SYSTEM_PROMPT },
        ]),
      },
    ],
  ];

  describe.each(cases)("when it arrives %s", (_shape, params) => {
    /** @scenario "A system prompt recorded as content blocks reads as one prompt" */
    it("shows the prompt once in front of the messages", () => {
      expect(buildDisplayInput(spanWith(params))).toBe(displayInput);
    });

    /** @scenario "A system prompt recorded as content blocks reads as one prompt" */
    it("keeps the prompt out of what the reviewer saves", () => {
      const seed = capturedInputForEditing({
        text: buildDisplayInput(spanWith(params)),
        params,
      });

      expect(seed).toBe(JSON.stringify(MESSAGES));
    });
  });
});

describe("given a span whose system prompt is several content blocks", () => {
  describe("when its input is read", () => {
    /** @scenario "A system prompt recorded as content blocks reads as one prompt" */
    it("reads them as one prompt, a line each", () => {
      const span = {
        input: { type: "chat_messages", value: MESSAGES },
        params: {
          "gen_ai.system_instructions": [
            { type: "text", content: "You are a weather assistant." },
            { type: "text", text: "Answer in one word." },
          ],
        },
      } as unknown as Pick<Span, "input" | "params">;

      expect(buildDisplayInput(span)).toBe(
        JSON.stringify([
          {
            role: "system",
            content: "You are a weather assistant.\nAnswer in one word.",
          },
          ...MESSAGES,
        ]),
      );
    });
  });
});

describe("given a span with no system prompt attribute", () => {
  describe("when the input editor is seeded", () => {
    /** @scenario "The system prompt shown with the messages is not edited into them" */
    it("seeds what was captured", () => {
      const recorded = JSON.stringify(MESSAGES);

      expect(capturedInputForEditing({ text: recorded, params: {} })).toBe(
        recorded,
      );
      expect(
        capturedInputForEditing({ text: "plain prose", params: null }),
      ).toBe("plain prose");
      expect(capturedInputForEditing({ text: null, params: null })).toBeNull();
    });
  });
});
