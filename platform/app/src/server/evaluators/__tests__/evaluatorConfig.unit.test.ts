/**
 * @vitest-environment node
 *
 * AC0c for langwatch#6397 — the write side cannot store a config shape the
 * online read path fails on.
 */

import { describe, expect, it } from "vitest";
import { resolveEvaluatorSettings } from "../../event-sourcing/pipelines/evaluation-processing/commands/executeEvaluation.command";
import { normalizeEvaluatorConfig } from "../evaluatorConfig";

describe("normalizeEvaluatorConfig", () => {
  describe("given settings written at the top level", () => {
    /** @scenario A config shape the online path cannot read cannot be written */
    it("nests them under settings so the read path resolves them", () => {
      const stored = normalizeEvaluatorConfig({
        evaluatorType: "langevals/llm_score",
        prompt: "Score this.",
        model: "gpt-5-mini",
      });

      expect(stored).toEqual({
        evaluatorType: "langevals/llm_score",
        settings: { prompt: "Score this.", model: "gpt-5-mini" },
      });
    });

    it("round-trips: what is stored is what the online path reads back", () => {
      const stored = normalizeEvaluatorConfig({
        evaluatorType: "langevals/llm_score",
        prompt: "Score this.",
      });

      expect(
        resolveEvaluatorSettings({ config: stored, parameters: null }),
      ).toMatchObject({ prompt: "Score this." });
    });
  });

  describe("given an already-correct config", () => {
    it("leaves it untouched", () => {
      const config = {
        evaluatorType: "langevals/llm_score",
        settings: { prompt: "Score this." },
      };

      expect(normalizeEvaluatorConfig(config)).toEqual(config);
    });
  });

  describe("given a config carrying only metadata", () => {
    it("does not invent a settings key", () => {
      const config = { evaluatorType: "langevals/llm_score" };

      expect(normalizeEvaluatorConfig(config)).toEqual(config);
    });

    it("keeps the legacy monitor.parameters fallback reachable", () => {
      // An invented empty `settings` would shadow monitor.parameters and break
      // evaluators that legitimately rely on the legacy fallback.
      const stored = normalizeEvaluatorConfig({
        evaluatorType: "langevals/llm_score",
      });

      expect(
        resolveEvaluatorSettings({
          config: stored,
          parameters: { prompt: "from the monitor" },
        }),
      ).toEqual({ prompt: "from the monitor" });
    });
  });

  describe("given both a nested settings and stray top-level keys", () => {
    it("lets the nested object win for keys it already defines", () => {
      const stored = normalizeEvaluatorConfig({
        evaluatorType: "langevals/llm_score",
        prompt: "the stray one",
        model: "gpt-5-mini",
        settings: { prompt: "the nested one" },
      });

      expect(stored).toEqual({
        evaluatorType: "langevals/llm_score",
        settings: { prompt: "the nested one", model: "gpt-5-mini" },
      });
    });
  });

  describe("given a value that is not a config object", () => {
    it("passes null, undefined and arrays through unchanged", () => {
      expect(normalizeEvaluatorConfig(null)).toBeNull();
      expect(normalizeEvaluatorConfig(undefined)).toBeUndefined();
      expect(normalizeEvaluatorConfig([1, 2])).toEqual([1, 2]);
    });
  });
});
