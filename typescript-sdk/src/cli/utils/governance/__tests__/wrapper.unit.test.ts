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

  // Regression: claude-code 2.x warns "Both ANTHROPIC_AUTH_TOKEN and
  // ANTHROPIC_API_KEY set, auth may not work as expected" when a
  // legacy ANTHROPIC_API_KEY is already exported in the user's
  // shell. The wrapper has to clear that twin from the inherited env
  // before spawn so the child only sees the gateway-routed
  // ANTHROPIC_AUTH_TOKEN. Asserted by listing the key in the per-tool
  // clears array.
  it("claude → clears ANTHROPIC_API_KEY (gateway auth uses AUTH_TOKEN, twin would conflict)", () => {
    const result = envForTool(cfg, "claude");
    expect(result.clears).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("codex → OPENAI_BASE_URL + OPENAI_API_KEY", () => {
    const env = envForTool(cfg, "codex").vars;
    expect(env.OPENAI_BASE_URL).toBe("http://gw.example.com");
    expect(env.OPENAI_API_KEY).toBe("lw_vk_test_x");
  });

  // codex sets OPENAI_API_KEY directly (the gateway auth is on the
  // same standard env var the openai SDK reads); there's no legacy
  // twin to scrub, so clears stays empty.
  it("codex → no clears (OPENAI_API_KEY is both legacy and gateway-routed)", () => {
    const result = envForTool(cfg, "codex");
    expect(result.clears ?? []).toEqual([]);
  });

  it("cursor → both Anthropic + OpenAI pairs", () => {
    const env = envForTool(cfg, "cursor").vars;
    expect(env.ANTHROPIC_BASE_URL).toBeDefined();
    expect(env.OPENAI_BASE_URL).toBeDefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("lw_vk_test_x");
    expect(env.OPENAI_API_KEY).toBe("lw_vk_test_x");
  });

  // Same warning surface as claude: cursor embeds Anthropic SDKs that
  // would pick up a legacy ANTHROPIC_API_KEY in preference to the
  // gateway-routed ANTHROPIC_AUTH_TOKEN and bypass the gateway. Scrub.
  it("cursor → clears ANTHROPIC_API_KEY (same legacy-twin scrub as claude)", () => {
    const result = envForTool(cfg, "cursor");
    expect(result.clears).toEqual(["ANTHROPIC_API_KEY"]);
  });

  // Verified empirically against gemini-cli 0.46-preview: the binary
  // reads GOOGLE_GEMINI_BASE_URL, NOT the previous GOOGLE_GENAI_API_BASE
  // guess. POSTs `{BASE}/v1beta/models/{m}:generateContent`, prepending
  // the API version itself. The base must therefore be the bare gateway
  // URL with no `/v1beta` suffix; appending one doubles the prefix to
  // `/v1beta/v1beta/` and the gateway 404s the routing call (which
  // surfaces on the cli side as "Unexpected end of JSON input").
  it("gemini → GOOGLE_GEMINI_BASE_URL=$gw (no /v1beta suffix) + GEMINI_API_KEY + GOOGLE_API_KEY", () => {
    const env = envForTool(cfg, "gemini").vars;
    expect(env.GOOGLE_GEMINI_BASE_URL).toBe("http://gw.example.com");
    expect(env.GEMINI_API_KEY).toBe("lw_vk_test_x");
    expect(env.GOOGLE_API_KEY).toBe("lw_vk_test_x");
    expect(env.GOOGLE_GENAI_API_BASE).toBeUndefined();
  });

  // gemini-cli reads GEMINI_API_KEY / GOOGLE_API_KEY directly; the
  // gateway routing token IS what we write to both, so there's no
  // legacy twin to scrub. Verifies the no-op explicitly so a future
  // refactor that adds an erroneous scrub here is caught.
  it("gemini → no clears (auth env names are the gateway-routed ones)", () => {
    const result = envForTool(cfg, "gemini");
    expect(result.clears ?? []).toEqual([]);
  });

  // opencode 1.x uses the Vercel AI SDK, which posts to
  // `{BASE}/messages` and `{BASE}/chat/completions` WITHOUT prepending
  // /v1. So opencode needs the base to ALREADY include /v1, unlike
  // claude-code + codex which append it themselves. Also opencode's
  // anthropic-provider auto-detect gates on ANTHROPIC_API_KEY, not
  // ANTHROPIC_AUTH_TOKEN — both must be set or `--model anthropic/...`
  // fails ProviderModelNotFoundError at init time.
  it("opencode → both Anthropic + OpenAI pairs with /v1 suffix + ANTHROPIC_API_KEY for provider auto-detect", () => {
    const env = envForTool(cfg, "opencode").vars;
    expect(env.OPENAI_BASE_URL).toBe("http://gw.example.com/v1");
    expect(env.OPENAI_API_KEY).toBe("lw_vk_test_x");
    expect(env.ANTHROPIC_BASE_URL).toBe("http://gw.example.com/v1");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("lw_vk_test_x");
    expect(env.ANTHROPIC_API_KEY).toBe("lw_vk_test_x");
  });

  // opencode INTENTIONALLY sets both ANTHROPIC_AUTH_TOKEN and
  // ANTHROPIC_API_KEY (the Vercel AI SDK's anthropic-provider
  // auto-detect gates on _API_KEY; the gateway routes on _AUTH_TOKEN).
  // Scrubbing either one would break opencode at provider-init time.
  // Pinned with an empty-clears assertion so anyone copy-pasting the
  // claude scrub here would fail this test.
  it("opencode → no clears (both Anthropic keys are intentionally set)", () => {
    const result = envForTool(cfg, "opencode");
    expect(result.clears ?? []).toEqual([]);
  });

  // Regression: claude + codex must NOT carry the /v1 suffix. Their
  // CLIs append /v1 themselves; a double /v1 would 404.
  it("claude + codex base URLs stay /v1-less (CLI appends /v1 itself)", () => {
    expect(envForTool(cfg, "claude").vars.ANTHROPIC_BASE_URL).toBe(
      "http://gw.example.com",
    );
    expect(envForTool(cfg, "codex").vars.OPENAI_BASE_URL).toBe(
      "http://gw.example.com",
    );
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
      default_personal_ingest_keys: {
        claude_code: { id: "ik_c", secret: "sk-lw-x", prefix: "sk-lw-" },
        codex: { id: "ik_co", secret: "sk-lw-y", prefix: "sk-lw-" },
        gemini: { id: "ik_g", secret: "sk-lw-z", prefix: "sk-lw-" },
        opencode: { id: "ik_o", secret: "sk-lw-w", prefix: "sk-lw-" },
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
