import {
  Config,
  environmentExactOneSchema,
  environmentLegacyTruthySchema,
  environmentNotExactOneSchema,
  environmentPresenceSchema,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";

/**
 * The local launcher parses only controls that affect its own supervision.
 * Provider credentials remain explicit child-process pass-through values;
 * they are not configuration for the launcher to inspect or retain.
 */
export const localOrchestratorConfigDefinition = RuntimeConfig.define({
  browser: {
    openEnabled: Config.value(environmentNotExactOneSchema, { env: "LANGWATCH_NO_OPEN" }),
    continuousIntegration: Config.value(environmentPresenceSchema, { env: "CI" }),
  },
  development: {
    aiGatewayDevBuild: Config.value(environmentExactOneSchema, {
      env: "LANGWATCH_AIGATEWAY_DEV_BUILD",
    }),
    forceBundledPostgres: Config.value(environmentLegacyTruthySchema, {
      env: "LANGWATCH_FORCE_BUNDLED_POSTGRES",
    }),
  },
});

export type LocalOrchestratorConfig = ConfigValue<typeof localOrchestratorConfigDefinition>;

export type LocalOrchestratorDevelopmentConfig = LocalOrchestratorConfig["development"];

/** Resolves local launcher controls once at the CLI composition boundary. */
export function resolveLocalOrchestratorConfig(
  source: Readonly<Record<string, unknown>>,
): LocalOrchestratorConfig {
  return RuntimeConfig.create({
    name: "local orchestrator",
    definition: localOrchestratorConfigDefinition,
    source,
  }).value;
}
