import {
  Config,
  environmentExactOneSchema,
  environmentLegacyTruthySchema,
  environmentNotExactOneSchema,
  environmentPresenceSchema,
  parseProcessConfig,
  type ConfigOf,
} from "@langwatch/config";

/**
 * The local launcher parses only controls that affect its own supervision.
 * Provider credentials remain explicit child-process pass-through values;
 * they are not configuration for the launcher to inspect or retain.
 */
export const localOrchestratorConfig = Config.define((c) => ({
  browser: {
    openEnabled: c.env("LANGWATCH_NO_OPEN", environmentNotExactOneSchema),
    continuousIntegration: c.env("CI", environmentPresenceSchema),
  },
  development: {
    aiGatewayDevBuild: c.env("LANGWATCH_AIGATEWAY_DEV_BUILD", environmentExactOneSchema),
    forceBundledPostgres: c.env("LANGWATCH_FORCE_BUNDLED_POSTGRES", environmentLegacyTruthySchema),
  },
}));

export type LocalOrchestratorConfig = ConfigOf<typeof localOrchestratorConfig>;

export type LocalOrchestratorDevelopmentConfig = LocalOrchestratorConfig["development"];

/** Resolves local launcher controls once at the CLI composition boundary. */
export function resolveLocalOrchestratorConfig(
  source: Readonly<Record<string, unknown>>,
): LocalOrchestratorConfig {
  const environment = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, typeof value === "string" ? value : void 0]),
  );

  return parseProcessConfig({
    owners: [{ name: "orchestrator", config: localOrchestratorConfig }],
    environment,
  }).orchestrator;
}
