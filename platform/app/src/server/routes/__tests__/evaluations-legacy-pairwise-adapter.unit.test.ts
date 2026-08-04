/**
 * The legacy `langevals/pairwise_compare` judge is never called by the app any
 * more (its config type is rerouted to select_best_compare in
 * resolveDispatchEvaluatorType). These pin the PAYLOAD half of that redirect —
 * translating the stored 2-slot wire shape into the N-way one — so the two
 * halves travel together and can't diverge the way #5528 did.
 *
 * spec: specs/experiments/comparison.feature
 *   - "Existing pairwise monitors keep running"
 *   - "A legacy pairwise experiment's structured-output field selection
 *      survives translation"
 */
import { describe, expect, it } from "vitest";
import {
  stripIncompatiblePairwisePrompt,
  translateLegacyPairwisePayload,
} from "../evaluations-legacy";

describe("translateLegacyPairwisePayload", () => {
  const pairwisePayload = {
    input: "How do I reset my password?",
    golden: "Use the Forgot Password link.",
    candidate_a_id: "variant-a",
    candidate_a_output: "Click Forgot Password.",
    candidate_a_cost: 0.01,
    candidate_a_duration: 1.2,
    candidate_b_id: "variant-b",
    candidate_b_output: "Contact support to reset it.",
    candidate_b_cost: 0.02,
    candidate_b_duration: 2.4,
  };

  describe("given a complete two-slot payload", () => {
    it("folds both slots into an ordered candidates list", () => {
      const { candidates } = translateLegacyPairwisePayload(
        pairwisePayload,
      ) as { candidates: Array<Record<string, unknown>> };

      expect(candidates).toEqual([
        {
          id: "variant-a",
          output: "Click Forgot Password.",
          cost: 0.01,
          duration: 1.2,
        },
        {
          id: "variant-b",
          output: "Contact support to reset it.",
          cost: 0.02,
          duration: 2.4,
        },
      ]);
    });

    it("preserves input and golden alongside the candidates", () => {
      const result = translateLegacyPairwisePayload(pairwisePayload);

      expect(result.input).toBe("How do I reset my password?");
      expect(result.golden).toBe("Use the Forgot Password link.");
    });

    it("removes the flat candidate_a_/candidate_b_ keys", () => {
      const result = translateLegacyPairwisePayload(pairwisePayload);

      expect(result).not.toHaveProperty("candidate_a_id");
      expect(result).not.toHaveProperty("candidate_a_output");
      expect(result).not.toHaveProperty("candidate_b_id");
      expect(result).not.toHaveProperty("candidate_b_output");
    });
  });

  // A legacy config where variantA is narrowed to output field "answer" reaches
  // this layer already narrowed (the orchestrator serialises the picked field
  // into candidate_a_output before dispatch), so the field selection is carried
  // by candidate_a_output's value — this asserts the value survives untouched.
  describe("given a slot whose output was narrowed to one structured field", () => {
    it("carries that narrowed value through as the candidate output", () => {
      const { candidates } = translateLegacyPairwisePayload({
        ...pairwisePayload,
        candidate_a_output: "just the answer field",
      }) as { candidates: Array<Record<string, unknown>> };

      expect(candidates[0]?.output).toBe("just the answer field");
    });
  });

  // #5528 shape guard: the resulting payload must key on `candidates`, the
  // field select_best_compare's Entry declares required — never the flat
  // candidate_a_* keys the old judge expected.
  describe("regression: the translated payload matches the new judge's contract", () => {
    it("exposes a `candidates` array and no `candidate_a_id`", () => {
      const result = translateLegacyPairwisePayload(pairwisePayload);

      expect(Array.isArray(result.candidates)).toBe(true);
      expect(result).not.toHaveProperty("candidate_a_id");
    });
  });

  describe("given an incomplete config where a slot has no id", () => {
    it("drops the empty slot rather than emitting a blank candidate", () => {
      const { candidates } = translateLegacyPairwisePayload({
        input: "task",
        candidate_a_id: "variant-a",
        candidate_a_output: "answer",
      }) as { candidates: Array<Record<string, unknown>> };

      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.id).toBe("variant-a");
    });
  });
});

describe("stripIncompatiblePairwisePrompt", () => {
  describe("given a pairwise prompt written for the old slot placeholders", () => {
    it("drops the prompt and flags it", () => {
      const { settings, droppedPrompt } = stripIncompatiblePairwisePrompt({
        model: "openai/gpt-5-mini",
        prompt: "Compare {candidate_a_output} against {candidate_b_output}.",
      });

      expect(droppedPrompt).toBe(true);
      expect(settings).not.toHaveProperty("prompt");
      expect(settings.model).toBe("openai/gpt-5-mini");
    });
  });

  describe("given a prompt already migrated to the {candidates} placeholder", () => {
    it("keeps it", () => {
      const migrated = {
        prompt: "Pick the best of {candidates} for {input}.",
      };
      const { settings, droppedPrompt } =
        stripIncompatiblePairwisePrompt(migrated);

      expect(droppedPrompt).toBe(false);
      expect(settings.prompt).toBe(migrated.prompt);
    });
  });

  describe("given settings with no prompt at all", () => {
    it("leaves them untouched", () => {
      const { settings, droppedPrompt } = stripIncompatiblePairwisePrompt({
        model: "openai/gpt-5-mini",
      });

      expect(droppedPrompt).toBe(false);
      expect(settings).toEqual({ model: "openai/gpt-5-mini" });
    });
  });
});
