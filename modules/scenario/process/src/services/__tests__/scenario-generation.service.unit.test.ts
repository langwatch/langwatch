/**
 * `ScenarioGenerationService` hands the model call main's generate cap.
 * @vitest-environment node
 */
import { parseProcessConfig } from "@langwatch/config";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { scenarioConfig } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { ScenarioGenerationService } from "../scenario-generation.service.ts";

const generateTimeoutFrom = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "scenario", config: scenarioConfig }], environment })
    .scenario.generateTimeoutMs;

function generationWith({ timeoutMs }: { timeoutMs: number }) {
  const calls: Parameters<ModelProviderApi["generateStructured"]>[0][] = [];
  const service = ScenarioGenerationService.create({
    bounds: { assertGenerateWithinBounds: () => Promise.resolve() },
    modelProviders: {
      generateStructured: (input) => {
        calls.push(input);
        return Promise.resolve({
          name: "Refund",
          situation: "Angry user",
          criteria: ["Apologises"],
        });
      },
    },
    timeoutMs,
  });
  return { service, calls };
}

describe("SCENARIO_GENERATE_TIMEOUT_MS", () => {
  it("defaults to 30 seconds when unset, zero, negative or not a number", () => {
    for (const value of [undefined, "", "0", "-5", "soon"]) {
      expect(generateTimeoutFrom({ SCENARIO_GENERATE_TIMEOUT_MS: value })).toBe(30_000);
    }
  });

  it("takes a positive override in milliseconds", () => {
    expect(generateTimeoutFrom({ SCENARIO_GENERATE_TIMEOUT_MS: "1500" })).toBe(1500);
  });
});

describe("ScenarioGenerationService", () => {
  describe("given SCENARIO_GENERATE_TIMEOUT_MS resolved to 50", () => {
    it("aborts the model call after 50 milliseconds with one retry", async () => {
      const { service, calls } = generationWith({ timeoutMs: 50 });

      await service.generate({
        projectId: "project-1",
        prompt: "An angry refund request",
        currentScenario: null,
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ timeoutMs: 50, maxRetries: 1 });
    });
  });
});
