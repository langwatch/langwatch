/**
 * @see modules/agent/specs/scenario-connector-agent.feature
 */
import { CONNECTOR_SECRET_NAMES_MAX } from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";

import { formFromAgent } from "../connector-form.ts";
import { CALL_STARTER } from "../connector-starters.ts";

describe("formFromAgent", () => {
  describe("given a saved config the schema now refuses", () => {
    /** @scenario "Reopening a connector whose saved config no longer parses keeps its blocks" */
    it("keeps its blocks and picks instead of the starter code", () => {
      const secretNames = Array.from(
        { length: CONNECTOR_SECRET_NAMES_MAX + 1 },
        (_, index) => `KEY_${index}`,
      );

      const form = formFromAgent({
        name: "Shop connector",
        config: {
          call: { language: "python", code: "call()" },
          setup: { language: "python", code: "setup()" },
          teardown: { language: "python", code: "teardown()" },
          secretNames,
          fixturesDatasetId: "dataset_1",
          timeoutMs: 30_000,
          description: "kept as stored",
        },
      });

      expect(form).toEqual({
        name: "Shop connector",
        callCode: "call()",
        setupCode: "setup()",
        teardownCode: "teardown()",
        secretNames,
        fixturesDatasetId: "dataset_1",
        timeoutSeconds: "30",
        kept: { description: "kept as stored" },
      });
      expect(form.callCode).not.toBe(CALL_STARTER);
    });
  });
});
