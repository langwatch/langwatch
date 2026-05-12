import { describe, it, expect } from "vitest";
import {
  buildMcpConfig,
  buildMcpJson,
  CLOUD_ENDPOINT,
} from "./build-mcp-config";

describe("buildMcpConfig()", () => {
  describe("when given only an API key", () => {
    it("returns config with only the API key in env", () => {
      const result = buildMcpConfig({ apiKey: "lw-abc123", endpoint: undefined });

      expect(result).toEqual({
        mcpServers: {
          langwatch: {
            command: "npx",
            args: ["-y", "@langwatch/mcp-server"],
            env: { LANGWATCH_API_KEY: "lw-abc123" },
          },
        },
      });
    });
  });

  describe("when the endpoint matches the cloud default", () => {
    it("omits the endpoint from env", () => {
      const result = buildMcpConfig({
        apiKey: "lw-abc123",
        endpoint: CLOUD_ENDPOINT,
      });

      const env = (result as any).mcpServers.langwatch.env;
      expect(env).not.toHaveProperty("LANGWATCH_ENDPOINT");
      expect(env.LANGWATCH_API_KEY).toBe("lw-abc123");
    });
  });

  describe("when the endpoint is a self-hosted URL", () => {
    it("includes the endpoint in env", () => {
      const result = buildMcpConfig({
        apiKey: "lw-abc123",
        endpoint: "https://langwatch.internal.company.com",
      });

      const env = (result as any).mcpServers.langwatch.env;
      expect(env.LANGWATCH_ENDPOINT).toBe(
        "https://langwatch.internal.company.com"
      );
      expect(env.LANGWATCH_API_KEY).toBe("lw-abc123");
    });
  });

  describe("when the endpoint is an empty string", () => {
    it("omits the endpoint from env", () => {
      const result = buildMcpConfig({ apiKey: "lw-abc123", endpoint: "" });

      const env = (result as any).mcpServers.langwatch.env;
      expect(env).not.toHaveProperty("LANGWATCH_ENDPOINT");
    });
  });
});

describe("buildMcpJson()", () => {
  describe("when called with a self-hosted endpoint", () => {
    it("returns valid JSON containing the endpoint", () => {
      const json = buildMcpJson({
        apiKey: "lw-test",
        endpoint: "https://custom.host",
      });

      const parsed = JSON.parse(json);
      expect(parsed.mcpServers.langwatch.env.LANGWATCH_ENDPOINT).toBe(
        "https://custom.host"
      );
    });
  });

  describe("when called with a cloud endpoint", () => {
    it("returns valid JSON without the endpoint", () => {
      const json = buildMcpJson({
        apiKey: "lw-test",
        endpoint: CLOUD_ENDPOINT,
      });

      const parsed = JSON.parse(json);
      expect(parsed.mcpServers.langwatch.env).not.toHaveProperty(
        "LANGWATCH_ENDPOINT"
      );
    });
  });

  it("returns pretty-printed JSON with 2-space indent", () => {
    const json = buildMcpJson({ apiKey: "lw-test", endpoint: undefined });

    expect(json).toContain("\n");
    expect(json).toMatch(/^ {2}"mcpServers"/m);
  });
});
