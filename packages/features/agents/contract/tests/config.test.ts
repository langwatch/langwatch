import { describe, expect, it } from "vitest";
import {
  AgentNotFoundError,
  agentProblemSchema,
  createAgentRequestSchema,
  parseAgentConfig,
} from "../src";

describe("agent config contract", () => {
  it("accepts the persisted signature shape", () => {
    expect(
      parseAgentConfig("signature", {
        prompt: "Answer clearly",
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "answer", type: "str" }],
      }),
    ).toMatchObject({ prompt: "Answer clearly" });
  });

  it("rejects a code agent without a code parameter", () => {
    expect(() => parseAgentConfig("code", { parameters: [] })).toThrow();
  });
});

describe("agent transport contract", () => {
  it("validates a complete create request with the type-specific schema", () => {
    expect(
      createAgentRequestSchema.parse({
        name: "HTTP agent",
        type: "http",
        config: { url: "https://example.com", method: "POST" },
      }),
    ).toMatchObject({ type: "http" });
  });

  it("publishes structured transport problems without an error-code registry", () => {
    const error = new AgentNotFoundError("agent_1", "project_1");
    expect(
      agentProblemSchema.parse({
        error: "agent_not_found",
        message: error.message,
        agentId: error.agentId,
        projectId: error.projectId,
      }),
    ).toMatchObject({ agentId: "agent_1", projectId: "project_1" });
  });
});
