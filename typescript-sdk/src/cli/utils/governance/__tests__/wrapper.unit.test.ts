import { describe, it, expect } from "vitest";
import { envForTool, preflightWrapper } from "../wrapper";
import type { GovernanceConfig } from "../config";

const cfg: GovernanceConfig = {
  gateway_url: "http://gw.example.com",
  control_plane_url: "http://app.example.com",
  default_personal_vk: { id: "vk_x", secret: "lw_vk_test_x", prefix: "lw_vk_t" },
};

const okFetch: typeof fetch = async () =>
  new Response(null, { status: 200 });
const refusedFetch: typeof fetch = async () => {
  throw new Error("connect ECONNREFUSED 127.0.0.1:5563");
};
const five03Fetch: typeof fetch = async () =>
  new Response("upstream", { status: 503 });

const bootstrapWith = (
  names: string[],
  adminEmail: string | null = "admin@acme.test",
) => async () => ({
  providers: names.map((name) => ({
    name,
    displayName: name,
    models: [`${name}-default`],
  })),
  budget: { monthlyLimitUsd: null, monthlyUsedUsd: 0, period: "month" },
  adminEmail,
});

describe("envForTool", () => {
  it("claude → ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN", () => {
    const env = envForTool(cfg, "claude").vars;
    expect(env.ANTHROPIC_BASE_URL).toBe("http://gw.example.com");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("lw_vk_test_x");
  });

  it("codex → OPENAI_BASE_URL + OPENAI_API_KEY", () => {
    const env = envForTool(cfg, "codex").vars;
    expect(env.OPENAI_BASE_URL).toBe("http://gw.example.com");
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
    expect(env.GOOGLE_GENAI_API_BASE).toBe("http://gw.example.com");
    expect(env.GEMINI_API_KEY).toBe("lw_vk_test_x");
  });

  it("opencode → both Anthropic + OpenAI pairs (multi-provider)", () => {
    const env = envForTool(cfg, "opencode").vars;
    expect(env.OPENAI_BASE_URL).toBe("http://gw.example.com");
    expect(env.OPENAI_API_KEY).toBe("lw_vk_test_x");
    expect(env.ANTHROPIC_BASE_URL).toBe("http://gw.example.com");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("lw_vk_test_x");
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

  it("never injects OTEL_*_EXPORTER for any wrapped tool (gateway captures I/O; OTLP would double-trace)", () => {
    const cfgWithIk: GovernanceConfig = {
      ...cfg,
      default_personal_ingestion_tokens: {
        claude_code: { id: "ik_c", secret: "ik-lw-x", prefix: "ik-lw-" },
        codex: { id: "ik_co", secret: "ik-lw-y", prefix: "ik-lw-" },
        gemini: { id: "ik_g", secret: "ik-lw-z", prefix: "ik-lw-" },
        opencode: { id: "ik_o", secret: "ik-lw-w", prefix: "ik-lw-" },
      },
    };
    for (const tool of ["claude", "codex", "gemini", "cursor", "opencode"]) {
      const env = envForTool(cfgWithIk, tool).vars;
      expect(env.OTEL_TRACES_EXPORTER).toBeUndefined();
      expect(env.OTEL_LOGS_EXPORTER).toBeUndefined();
      expect(env.OTEL_METRICS_EXPORTER).toBeUndefined();
      expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
      expect(env.CLAUDE_CODE_ENABLE_TELEMETRY).toBeUndefined();
      expect(env.GEMINI_TELEMETRY_ENABLED).toBeUndefined();
    }
  });

  it("strips trailing slash from gateway_url", () => {
    const trailing: GovernanceConfig = { ...cfg, gateway_url: "http://gw.example.com/" };
    const env = envForTool(trailing, "claude").vars;
    expect(env.ANTHROPIC_BASE_URL).toBe("http://gw.example.com");
  });
});

describe("preflightWrapper", () => {
  describe("given the personal VK is missing", () => {
    it("fails fast with a model-providers setup hint", async () => {
      const noVk: GovernanceConfig = { ...cfg, default_personal_vk: undefined };
      const r = await preflightWrapper(noVk, "claude", {
        fetchImpl: okFetch,
        bootstrapImpl: bootstrapWith(["anthropic"]),
      });
      expect(r.ok).toBe(false);
      expect(r.message).toContain("No personal virtual key");
      expect(r.message).toContain("/settings/model-providers");
      expect(r.message).not.toContain("/settings/providers\n"); // exact URL check
      expect(r.message).toContain("langwatch login --device");
      expect(r.message).toContain("admin@acme.test"); // contact footer
    });
  });

  describe("given the gateway is unreachable", () => {
    it("surfaces the network error without naming a specific run command", async () => {
      const r = await preflightWrapper(cfg, "claude", {
        fetchImpl: refusedFetch,
        bootstrapImpl: bootstrapWith(["anthropic"]),
      });
      expect(r.ok).toBe(false);
      expect(r.message).toContain("Cannot reach AI Gateway");
      expect(r.message).toContain("ECONNREFUSED");
      expect(r.message).toContain("LangWatch gateway is running");
      // Deployment shape varies (helm / docker-compose / npx / make);
      // never recommend a dev-only command like `make service`.
      expect(r.message).not.toContain("make service");
      expect(r.message).toContain("admin@acme.test");
    });

    it("treats non-2xx as fatal too", async () => {
      const r = await preflightWrapper(cfg, "claude", {
        fetchImpl: five03Fetch,
        bootstrapImpl: bootstrapWith(["anthropic"]),
      });
      expect(r.ok).toBe(false);
      expect(r.message).toContain("returned HTTP 503");
      expect(r.message).not.toContain("make service");
    });

    it("falls back to generic admin line when bootstrap has no admin email", async () => {
      const r = await preflightWrapper(cfg, "claude", {
        fetchImpl: refusedFetch,
        bootstrapImpl: bootstrapWith(["anthropic"], null),
      });
      expect(r.ok).toBe(false);
      expect(r.message).toContain("contact your LangWatch admin");
      expect(r.message).not.toMatch(/admin@/);
    });
  });

  describe("given the org has no matching upstream provider", () => {
    it("blocks claude when only openai is configured", async () => {
      const r = await preflightWrapper(cfg, "claude", {
        fetchImpl: okFetch,
        bootstrapImpl: bootstrapWith(["openai"]),
      });
      expect(r.ok).toBe(false);
      expect(r.message).toContain("`anthropic`");
      expect(r.message).toContain("/settings/model-providers");
      expect(r.message).toContain("admin@acme.test");
    });

    it("passes cursor when either anthropic OR openai is present", async () => {
      const r = await preflightWrapper(cfg, "cursor", {
        fetchImpl: okFetch,
        bootstrapImpl: bootstrapWith(["openai"]),
      });
      expect(r.ok).toBe(true);
    });

    it("passes gemini when google or gemini family is present", async () => {
      const r = await preflightWrapper(cfg, "gemini", {
        fetchImpl: okFetch,
        bootstrapImpl: bootstrapWith(["google"]),
      });
      expect(r.ok).toBe(true);
    });
  });

  describe("given all probes pass", () => {
    it("returns ok=true", async () => {
      const r = await preflightWrapper(cfg, "claude", {
        fetchImpl: okFetch,
        bootstrapImpl: bootstrapWith(["anthropic", "openai"]),
      });
      expect(r.ok).toBe(true);
    });
  });

  describe("given bootstrap is unavailable (older server / network blip)", () => {
    it("degrades to provider-check-skipped rather than blocking", async () => {
      const r = await preflightWrapper(cfg, "claude", {
        fetchImpl: okFetch,
        bootstrapImpl: async () => {
          throw new Error("bootstrap unreachable");
        },
      });
      expect(r.ok).toBe(true);
    });
  });
});
