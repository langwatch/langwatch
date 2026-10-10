import { describe, expect, it } from "vitest";

import { parseJourneys, parseJson, replanSchema } from "../plan.ts";

const journey = (id: string) => ({
  id,
  goal: `Create ${id}`,
  start: "/{slug}/datasets",
  steps: ["Click New dataset", "Save"],
  values: { name: "Sim {uid}" },
  proof: { path: "/{slug}/datasets", texts: ["Sim {uid}"] },
});

describe("parseJourneys", () => {
  describe("when Sonnet fences its plan and says a word around it", () => {
    it("reads the journeys out of the fence", () => {
      const text = `Here is the plan:\n\`\`\`json\n${JSON.stringify({ journeys: [journey("create")] })}\n\`\`\`\nDone.`;
      expect(parseJourneys({ text, limit: 3 }).map((planned) => planned.id)).toEqual(["create"]);
    });
  });

  describe("when the plan has more journeys than asked, one twice", () => {
    it("keeps each id once, up to the limit", () => {
      const text = JSON.stringify({
        journeys: [journey("a"), journey("a"), journey("b"), journey("c")],
      });
      expect(parseJourneys({ text, limit: 2 }).map((planned) => planned.id)).toEqual(["a", "b"]);
    });
  });

  describe("when a journey has no proof", () => {
    it("refuses the plan", () => {
      const text = JSON.stringify({ journeys: [{ ...journey("a"), proof: undefined }] });
      expect(() => parseJourneys({ text, limit: 3 })).toThrow(/proof/);
    });
  });

  describe("when the answer holds no JSON", () => {
    it("says so", () => {
      expect(() => parseJourneys({ text: "I cannot plan this.", limit: 3 })).toThrow(
        /no JSON object/,
      );
    });
  });
});

describe("parseJson", () => {
  describe("when Sonnet re-plans a journey", () => {
    it("reads the revised steps", () => {
      const text = '{"status": "continue", "reason": "wrong button", "steps": ["Open the menu"]}';
      expect(parseJson({ text, schema: replanSchema })).toEqual({
        status: "continue",
        reason: "wrong button",
        steps: ["Open the menu"],
      });
    });
  });
});
