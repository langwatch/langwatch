/**
 * An HTTP agent's editor writes only the keys it shows; a save keeps the rest as stored.
 * @vitest-environment node
 */
import { httpAgentConfigSchema, type HttpAgentConfig } from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";

import { httpConfigKeepingStored } from "../use-http-agent-editor.ts";

const stored: HttpAgentConfig = httpAgentConfigSchema.parse({
  url: "https://agent.test/chat",
  method: "POST",
  bodyTemplate: "{}",
  outputPath: "$.answer",
  description: "HTTP API endpoint",
  name: "HTTP",
  headers: [{ key: "X-Team", value: "support" }],
  scenarioMappings: { input: { type: "source", sourceId: "scenario", path: ["input"] } },
  auth: { type: "bearer", token: "" },
  timeoutMs: 20_000,
  sessionPath: "$.session",
  devTunnel: { previousUrl: "https://agent.test/chat" },
  inputs: [{ identifier: "question", type: "str" }],
});

const edited: HttpAgentConfig = {
  name: "HTTP",
  description: "HTTP API endpoint",
  url: "https://agent.test/v2/chat",
  method: "PUT",
  bodyTemplate: '{"q": 1}',
  outputPath: "$.reply",
};

describe("given a stored HTTP agent", () => {
  describe("when the editor saves it", () => {
    const saved = httpConfigKeepingStored({ stored, edited });

    it("writes what the editor changed", () => {
      expect(saved).toMatchObject(edited);
    });

    it("keeps the timeout, the dev tunnel and the declared inputs", () => {
      expect(saved.timeoutMs).toBe(20_000);
      expect(saved.devTunnel).toEqual({ previousUrl: "https://agent.test/chat" });
      expect(saved.inputs).toEqual([{ identifier: "question", type: "str" }]);
    });

    it("drops what the editor cleared, rather than restoring the stored value", () => {
      expect(saved).not.toHaveProperty("headers");
      expect(saved).not.toHaveProperty("auth");
      expect(saved).not.toHaveProperty("sessionPath");
      expect(saved).not.toHaveProperty("scenarioMappings");
    });
  });

  it("writes a new agent's config as the editor built it", () => {
    expect(httpConfigKeepingStored({ stored: void 0, edited })).toBe(edited);
  });
});
