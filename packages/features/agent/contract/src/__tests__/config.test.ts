import { describe, expect, it } from "vitest";
import {
  AgentNotFoundError,
  agentProblemSchema,
  createAgentRequestSchema,
  parseAgentConfig,
} from "../index.ts";

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

  it.each([42, null, {}, []])(
    "rejects a malformed code value %j through the generic field branch",
    (value) => {
      expect(() =>
        parseAgentConfig("code", {
          parameters: [{ identifier: "code", type: "code", value }],
        }),
      ).toThrow();
    },
  );

  it("rejects a malformed duplicate beside a valid code parameter", () => {
    expect(() =>
      parseAgentConfig("code", {
        parameters: [
          { identifier: "code", type: "code", value: "print(1)" },
          { identifier: "code", type: "str", value: 42 },
        ],
      }),
    ).toThrow();
  });

  it("keeps HTTP defaults and base fields while stripping unknown fields", () => {
    expect(
      parseAgentConfig("http", {
        url: "https://example.com",
        description: "Send a request",
        unexpected: true,
        auth: { type: "bearer", token: "test-token", unexpected: true },
      }),
    ).toEqual({
      url: "https://example.com",
      method: "POST",
      description: "Send a request",
      auth: { type: "bearer", token: "test-token" },
    });
  });

  it("keeps connected defaults and omits the excluded description", () => {
    expect(
      parseAgentConfig("connected", {
        name: "Connected agent",
        description: "This field is not persisted",
        sdk: { name: "langwatch", version: "1", language: "python", unexpected: true },
      }),
    ).toEqual({
      name: "Connected agent",
      parameters: [],
      sdk: { name: "langwatch", version: "1", language: "python" },
    });
  });

  it("still rejects extra fields in a strict connected parameter", () => {
    expect(() =>
      parseAgentConfig("connected", {
        parameters: [{ name: "temperature", unexpected: true }],
        sdk: { name: "langwatch", version: "1", language: "python" },
      }),
    ).toThrow();
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
