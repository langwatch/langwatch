import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { evaluationServerConfigDefinition } from "../evaluation.config.ts";

describe("evaluation server configuration", () => {
  describe("given a deployment runs no evaluator service", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("boots with no endpoint rather than refusing", () => {
      expect(
        RuntimeConfig.create({
          name: "evaluation",
          definition: evaluationServerConfigDefinition,
          source: {},
        }).value.langevalsEndpoint,
      ).toBeUndefined();
    });
  });
});
