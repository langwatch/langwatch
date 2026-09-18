import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { evaluationConfig } from "../evaluation.config.ts";

describe("evaluation server configuration", () => {
  describe("given a deployment runs no evaluator service", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("boots with no endpoint rather than refusing", () => {
      expect(
        parseProcessConfig({
          owners: [{ name: "evaluation", config: evaluationConfig }],
          environment: {},
        }).evaluation.langevalsEndpoint,
      ).toBeUndefined();
    });
  });
});
