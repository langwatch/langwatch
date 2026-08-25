import { describe, expect, it } from "vitest";
import { PROVIDER_ID, buildModelsJson } from "./models.js";
import type { LangyWorkerModelConfig } from "./config.js";

const model: LangyWorkerModelConfig = {
  id: "gpt-5-mini",
  api: "openai-responses",
  baseUrlEnv: "OPENAI_BASE_URL",
  apiKeyEnv: "OPENAI_API_KEY",
  reasoning: true,
  contextWindow: 272000,
  maxTokens: 32000,
  compat: { supportsStore: false },
};

describe("buildModelsJson", () => {
  describe("when the base URL env var is set", () => {
    it("writes the resolved base URL literally and the API key as an env REFERENCE", () => {
      const generated = buildModelsJson({
        model,
        env: {
          OPENAI_BASE_URL: "http://127.0.0.1:41234/v1",
          OPENAI_API_KEY: "sk-secret",
        },
      });
      const provider = generated.providers[PROVIDER_ID] as Record<string, unknown>;
      expect(provider.baseUrl).toBe("http://127.0.0.1:41234/v1");
      expect(provider.api).toBe("openai-responses");
      // The secret itself must never appear: pi resolves $OPENAI_API_KEY at request time.
      expect(provider.apiKey).toBe("$OPENAI_API_KEY");
      expect(JSON.stringify(generated)).not.toContain("sk-secret");
    });

    it("passes model fields (compat included) through verbatim, minus the env pointers", () => {
      const generated = buildModelsJson({
        model: { ...model, samplingParams: { temperature: 1 } } as LangyWorkerModelConfig,
        env: { OPENAI_BASE_URL: "http://x", OPENAI_API_KEY: "k" },
      });
      const provider = generated.providers[PROVIDER_ID] as {
        models: Record<string, unknown>[];
      };
      const entry = provider.models[0] as Record<string, unknown>;
      expect(entry.id).toBe("gpt-5-mini");
      expect(entry.reasoning).toBe(true);
      expect(entry.contextWindow).toBe(272000);
      expect(entry.maxTokens).toBe(32000);
      expect(entry.compat).toEqual({ supportsStore: false });
      expect(entry.samplingParams).toEqual({ temperature: 1 });
      expect(entry.baseUrlEnv).toBeUndefined();
      expect(entry.apiKeyEnv).toBeUndefined();
    });
  });

  describe("when a missing env var", () => {
    it("fails with the variable name", () => {
      expect(() => buildModelsJson({ model, env: { OPENAI_API_KEY: "k" } })).toThrow(
        /OPENAI_BASE_URL/,
      );
      expect(() =>
        buildModelsJson({ model, env: { OPENAI_BASE_URL: "http://x" } }),
      ).toThrow(/OPENAI_API_KEY/);
    });
  });

  describe("when a model pi's own catalog lists for the same API dialect", () => {
    const claude: LangyWorkerModelConfig = {
      id: "anthropic/claude-opus-5",
      api: "anthropic-messages",
      baseUrlEnv: "ANTHROPIC_BASE_URL",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      reasoning: true,
    };
    const env = { ANTHROPIC_BASE_URL: "http://127.0.0.1:41234", ANTHROPIC_API_KEY: "k" };

    const entryOf = (config: LangyWorkerModelConfig) => {
      const provider = buildModelsJson({ model: config, env }).providers[PROVIDER_ID] as {
        baseUrl: string;
        models: Record<string, unknown>[];
      };
      return { provider, entry: provider.models[0] as Record<string, unknown> };
    };

    /** @scenario A known model's registry entry keeps pi's own catalog knowledge */
    it("carries the catalog's request-shape flags and thinking levels under our id", () => {
      const { entry } = entryOf(claude);
      // Claude 5 rejects the legacy thinking request shape; pi switches to the
      // adaptive shape only when the model entry carries this catalog flag.
      expect(entry.compat).toMatchObject({ forceAdaptiveThinking: true });
      expect(entry.thinkingLevelMap).toMatchObject({ xhigh: "xhigh", max: "max" });
      expect(entry.contextWindow).toBeGreaterThan(0);
      expect(entry.maxTokens).toBeGreaterThan(0);
      // The id stays provider-prefixed: the gateway routes on the prefix.
      expect(entry.id).toBe("anthropic/claude-opus-5");
    });

    /** @scenario A known model's registry entry keeps pi's own catalog knowledge */
    it("routes through the mediated gateway URL, never the catalog's own endpoint", () => {
      const { provider, entry } = entryOf(claude);
      expect(provider.baseUrl).toBe("http://127.0.0.1:41234");
      expect(entry.baseUrl).toBeUndefined();
      expect(entry.provider).toBeUndefined();
      expect(JSON.stringify(buildModelsJson({ model: claude, env }))).not.toContain(
        "api.anthropic.com",
      );
    });

    /** @scenario A known model's registry entry keeps pi's own catalog knowledge */
    it("lets the manager's explicit fields win over the catalog, key by key", () => {
      const { entry } = entryOf({
        ...claude,
        maxTokens: 9000,
        compat: { forceAdaptiveThinking: false },
      });
      expect(entry.maxTokens).toBe(9000);
      const compat = entry.compat as Record<string, unknown>;
      expect(compat.forceAdaptiveThinking).toBe(false);
      // Catalog compat keys the config does not name survive the override.
      expect(compat.supportsTemperature).toBe(false);
    });

    it("skips the catalog when the manager chose a different API dialect for the same id", () => {
      const { entry } = entryOf({ ...claude, api: "openai-completions" });
      expect(entry.compat).toBeUndefined();
      expect(entry.thinkingLevelMap).toBeUndefined();
    });
  });

  describe("when a model pi's catalog does not know", () => {
    /** @scenario A model pi's catalog does not know is written from config alone */
    it("writes exactly the manager's config, for unknown ids and unprefixed ids alike", () => {
      const env = { OPENAI_BASE_URL: "http://x", OPENAI_API_KEY: "k" };
      for (const id of ["anthropic/claude-acme-1", "gpt-5-mini"]) {
        const provider = buildModelsJson({ model: { ...model, id }, env }).providers[
          PROVIDER_ID
        ] as {
          models: Record<string, unknown>[];
        };
        expect(provider.models[0]).toEqual({
          id,
          api: "openai-responses",
          reasoning: true,
          contextWindow: 272000,
          maxTokens: 32000,
          compat: { supportsStore: false },
        });
      }
    });
  });

  describe("when the config carries routing or credential keys", () => {
    // The model config passes unknown keys through on purpose, so a new compat
    // flag needs no wrapper change. Routing and credential keys must not ride
    // that path: a model-level baseUrl or provider sends pi straight at the
    // provider instead of through the mediated gateway, and a literal apiKey
    // would write the secret into models.json when the provider block
    // deliberately references it by env NAME.
    /** @scenario A model entry cannot carry its own endpoint or credential */
    it("drops baseUrl, provider and apiKey while keeping the gateway's own", () => {
      const generated = buildModelsJson({
        model: {
          ...model,
          baseUrl: "https://api.openai.com/v1",
          provider: "openai",
          apiKey: "sk-leaked",
        } as typeof model,
        env: {
          OPENAI_BASE_URL: "http://127.0.0.1:41234/v1",
          OPENAI_API_KEY: "sk-secret",
        },
      });
      const provider = generated.providers[PROVIDER_ID] as {
        baseUrl: string;
        apiKey: string;
        models: Record<string, unknown>[];
      };

      expect(provider.baseUrl).toBe("http://127.0.0.1:41234/v1");
      expect(provider.apiKey).toBe("$OPENAI_API_KEY");
      expect(provider.models[0]).not.toHaveProperty("baseUrl");
      expect(provider.models[0]).not.toHaveProperty("provider");
      expect(provider.models[0]).not.toHaveProperty("apiKey");
      expect(JSON.stringify(generated)).not.toContain("sk-leaked");
      expect(JSON.stringify(generated)).not.toContain("sk-secret");
    });
  });
});
