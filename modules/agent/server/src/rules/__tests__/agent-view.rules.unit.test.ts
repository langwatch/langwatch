/**
 * @see specs/experiments-v3/workflow-agent-target-fields.feature
 */
import { describe, expect, it } from "vitest";

import { agentFixture } from "../../app/__tests__/agent.fixture.ts";
import { agentWithResolvedFields } from "../agent-view.rules.ts";

describe("given a code agent whose config declares its own fields", () => {
  describe("when the agent is read", () => {
    /** @scenario "A code agent keeps reporting the fields saved on its own config" */
    it("reports the fields off the config, resolved, with no graph consulted", () => {
      const agent = agentFixture({
        type: "code",
        config: {
          name: "scorer",
          inputs: [{ identifier: "text", type: "str" }],
          outputs: [{ identifier: "answer", type: "str" }],
          parameters: [{ identifier: "code", type: "code", value: "pass" }],
        },
      });

      const read = agentWithResolvedFields(agent, {});

      expect(read.inputFields).toEqual([{ identifier: "text", type: "str" }]);
      expect(read.outputFields).toEqual([{ identifier: "answer", type: "str" }]);
      expect(read.fieldsResolved).toBe(true);
    });
  });
});
