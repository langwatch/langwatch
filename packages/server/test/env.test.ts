import { describe, expect, it } from "vitest";
import { allocatePorts } from "../src/shared/ports.ts";
import { buildEnv } from "../src/shared/env.ts";

describe("buildEnv", () => {
  describe("when given the default port base", () => {
    const env = buildEnv({ ports: allocatePorts(5560) });

    it("targets every URL at the matching port (app tier 5560-3, infra tier 6560-3)", () => {
      expect(env).toContain("BASE_HOST=http://localhost:5560");
      expect(env).toContain("DATABASE_URL=postgresql://langwatch@localhost:6560");
      expect(env).toContain("REDIS_URL=redis://localhost:6561/0");
      expect(env).toContain("CLICKHOUSE_URL=http://localhost:6562/langwatch");
      expect(env).toContain("LANGWATCH_NLP_SERVICE=http://localhost:5561");
      expect(env).toContain("LANGEVALS_ENDPOINT=http://localhost:5562");
      expect(env).toContain("LW_GATEWAY_BASE_URL=http://localhost:5560");
    });

    it("populates every secret with a fresh random value", () => {
      const env2 = buildEnv({ ports: allocatePorts(5560) });
      const secret = (text: string, key: string) =>
        text.split("\n").find((line) => line.startsWith(`${key}=`))?.split("=")[1];
      expect(secret(env, "NEXTAUTH_SECRET")).not.toBe(secret(env2, "NEXTAUTH_SECRET"));
      expect(secret(env, "CREDENTIALS_SECRET")).toMatch(/^[a-f0-9]{64}$/);
      expect(secret(env, "API_TOKEN_JWT_SECRET")).toMatch(/^[a-f0-9]{64}$/);
      expect(secret(env, "LW_VIRTUAL_KEY_PEPPER")).toMatch(/^[a-f0-9]{64}$/);
      expect(secret(env, "LW_GATEWAY_INTERNAL_SECRET")).toMatch(/^[a-f0-9]{64}$/);
      expect(secret(env, "LW_GATEWAY_JWT_SECRET")).toMatch(/^[a-f0-9]{64}$/);
    });

    it("leaves model API keys empty for the user to fill in", () => {
      expect(env).toContain("OPENAI_API_KEY=\n");
      expect(env).toContain("ANTHROPIC_API_KEY=\n");
    });
  });

  describe("when given an override", () => {
    it("replaces the value in place rather than appending a duplicate", () => {
      const env = buildEnv({
        ports: allocatePorts(5560),
        overrides: { OPENAI_API_KEY: "sk-test-123" },
      });
      const lines = env.split("\n").filter((l) => l.startsWith("OPENAI_API_KEY="));
      expect(lines).toEqual(["OPENAI_API_KEY=sk-test-123"]);
    });
  });

  describe("when given a custom port base", () => {
    it("shifts every URL to the new slot in lockstep across both tiers", () => {
      const env = buildEnv({ ports: allocatePorts(5610) });
      expect(env).toContain("BASE_HOST=http://localhost:5610");
      expect(env).toContain("DATABASE_URL=postgresql://langwatch@localhost:6610");
      expect(env).toContain("REDIS_URL=redis://localhost:6611/0");
    });
  });

  describe("when nlpMode defaults (go)", () => {
    const env = buildEnv({ ports: allocatePorts(5560) });

    it("force-enables release_nlp_go_engine_enabled so /studio/* routes hit nlpgo", () => {
      expect(env).toContain("FEATURE_FLAG_FORCE_ENABLE=release_nlp_go_engine_enabled");
    });

    it("records the mode as `go` for later diagnosis", () => {
      expect(env).toContain("LANGWATCH_NPX_NLP=go");
    });
  });

  describe("when nlpMode is python", () => {
    const env = buildEnv({ ports: allocatePorts(5560), nlpMode: "python" });

    it("omits FEATURE_FLAG_FORCE_ENABLE so PostHog default routes traffic to legacy langwatch_nlp", () => {
      expect(env).not.toContain("FEATURE_FLAG_FORCE_ENABLE");
    });

    it("records the mode as `python` for later diagnosis", () => {
      expect(env).toContain("LANGWATCH_NPX_NLP=python");
    });
  });

  describe("when nlpMode is explicitly go", () => {
    it("matches default (go) behavior", () => {
      const explicit = buildEnv({ ports: allocatePorts(5560), nlpMode: "go" });
      expect(explicit).toContain("FEATURE_FLAG_FORCE_ENABLE=release_nlp_go_engine_enabled");
      expect(explicit).toContain("LANGWATCH_NPX_NLP=go");
    });
  });
});
