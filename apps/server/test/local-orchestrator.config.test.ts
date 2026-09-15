import { describe, expect, it } from "vitest";
import { resolveLocalOrchestratorConfig } from "../src/platform/config/local-orchestrator.config.ts";

describe("local orchestrator configuration", () => {
  it("projects launcher controls without retaining unrelated provider credentials", () => {
    const config = resolveLocalOrchestratorConfig({
      LANGWATCH_NO_OPEN: "1",
      CI: "true",
      LANGWATCH_AIGATEWAY_DEV_BUILD: "1",
      LANGWATCH_FORCE_BUNDLED_POSTGRES: "1",
      OPENAI_API_KEY: "must-not-cross-the-launcher-config-boundary",
    });

    expect(config).toEqual({
      browser: { openEnabled: false, continuousIntegration: true },
      development: { aiGatewayDevBuild: true, forceBundledPostgres: true },
    });
    expect(config).not.toHaveProperty("OPENAI_API_KEY");
  });

  it("preserves the legacy CI presence and no-open semantics", () => {
    expect(resolveLocalOrchestratorConfig({ CI: "0" }).browser.continuousIntegration).toBe(true);
    expect(resolveLocalOrchestratorConfig({ LANGWATCH_NO_OPEN: "true" }).browser.openEnabled).toBe(
      true,
    );
  });

  it("retains the bundled Postgres compatibility spellings while keeping the gateway exact", () => {
    expect(
      resolveLocalOrchestratorConfig({ LANGWATCH_FORCE_BUNDLED_POSTGRES: "true" }).development
        .forceBundledPostgres,
    ).toBe(true);
    expect(
      resolveLocalOrchestratorConfig({ LANGWATCH_FORCE_BUNDLED_POSTGRES: "yes" }).development
        .forceBundledPostgres,
    ).toBe(true);
    expect(
      resolveLocalOrchestratorConfig({ LANGWATCH_AIGATEWAY_DEV_BUILD: "true" }).development
        .aiGatewayDevBuild,
    ).toBe(false);
  });
});
