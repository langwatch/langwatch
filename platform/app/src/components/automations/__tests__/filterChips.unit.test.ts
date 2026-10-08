import { describe, expect, it } from "vitest";
import { filterChipsOf } from "../filterChips";

describe("filterChipsOf", () => {
  describe("given a keyed field stored nested under its key", () => {
    /** @scenario "A keyed filter chip names its key" */
    it("names the key beside the field", () => {
      expect(filterChipsOf({ "metadata.value": { plan: ["true"] } })).toEqual([
        {
          kind: "condition",
          id: "metadata.value:plan",
          label: "Metadata",
          keys: ["plan"],
          value: "true",
        },
      ]);
    });

    it("names the key and subkey of a doubly keyed field", () => {
      const [chip] = filterChipsOf({
        "events.metrics.value": { thumbs: { vote: ["1"] } },
      });
      expect(chip).toMatchObject({ keys: ["thumbs", "vote"], value: "1" });
    });
  });

  describe("given a keyed field stored as a bare list", () => {
    /** @scenario "A keyed filter stored without its key is flagged as never matching" */
    it("marks it unkeyed and shows the nested shape it needed", () => {
      expect(filterChipsOf({ "evaluations.passed": ["false"] })).toEqual([
        {
          kind: "unkeyed",
          id: "evaluations.passed",
          label: "Evaluation Passed",
          keyNoun: "monitor",
          example: '{"evaluations.passed":{"<monitorId>":["false"]}}',
        },
      ]);
    });
  });

  describe("given an unkeyed field", () => {
    it("shows its registry name and values", () => {
      expect(filterChipsOf('{"spans.model":["gpt-5","gpt-4o"]}')).toEqual([
        {
          kind: "condition",
          id: "spans.model",
          label: "Model",
          keys: [],
          value: "gpt-5, gpt-4o",
        },
      ]);
    });
  });

  describe("given empty lists or malformed JSON", () => {
    it("shows no chip", () => {
      expect(filterChipsOf({ "spans.model": [] })).toEqual([]);
      expect(filterChipsOf("{not json")).toEqual([]);
    });
  });
});
