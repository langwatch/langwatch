import { describe, it, expect } from "vitest";
import { envForTool } from "../wrapper";
import type { GovernanceConfig } from "../config";

const cfg: GovernanceConfig = {
  gateway_url: "http://gw.example.com",
  control_plane_url: "http://app.example.com",
  default_personal_vk: { id: "vk_x", secret: "lw_vk_test_x", prefix: "lw_vk_t" },
};

describe("envForTool", () => {
  it("claude → ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN", () => {
    const env = envForTool(cfg, "claude").vars;
    expect(env.ANTHROPIC_BASE_URL).toBe("http://gw.example.com/api/v1/anthropic");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("lw_vk_test_x");
  });

  it("codex → OPENAI_BASE_URL + OPENAI_API_KEY", () => {
    const env = envForTool(cfg, "codex").vars;
    expect(env.OPENAI_BASE_URL).toBe("http://gw.example.com/api/v1/openai");
    expect(env.OPENAI_API_KEY).toBe("lw_vk_test_x");
  });

  it("cursor → both Anthropic + OpenAI pairs", () => {
    const env = envForTool(cfg, "cursor").vars;
    expect(env.ANTHROPIC_BASE_URL).toBeDefined();
    expect(env.OPENAI_BASE_URL).toBeDefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("lw_vk_test_x");
    expect(env.OPENAI_API_KEY).toBe("lw_vk_test_x");
  });

  it("gemini → GOOGLE_GENAI_API_BASE + GEMINI_API_KEY", () => {
    const env = envForTool(cfg, "gemini").vars;
    expect(env.GOOGLE_GENAI_API_BASE).toBe("http://gw.example.com/api/v1/gemini");
    expect(env.GEMINI_API_KEY).toBe("lw_vk_test_x");
  });

  it("unknown tool → empty env", () => {
    const env = envForTool(cfg, "nonsense").vars;
    expect(env).toEqual({});
  });

  it("config without personal VK → empty env (wrapper exits with login error)", () => {
    const noVk: GovernanceConfig = { ...cfg, default_personal_vk: undefined };
    const env = envForTool(noVk, "claude").vars;
    expect(env).toEqual({});
  });

  it("strips trailing slash from gateway_url", () => {
    const trailing: GovernanceConfig = { ...cfg, gateway_url: "http://gw.example.com/" };
    const env = envForTool(trailing, "claude").vars;
    expect(env.ANTHROPIC_BASE_URL).toBe("http://gw.example.com/api/v1/anthropic");
  });
});
