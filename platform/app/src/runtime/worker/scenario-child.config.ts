import { Config, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { decodeScenarioLogContext, type ScenarioLogContext } from "@langwatch/scenario-server";
import { z } from "zod";

const scenarioChildProcessConfigDefinition = RuntimeConfig.define({
  langwatchEndpoint: Config.value(z.string().optional(), { env: "LANGWATCH_ENDPOINT" }),
  langwatchApiKey: Config.value(z.string().optional(), { env: "LANGWATCH_API_KEY" }),
  verbose: Config.value(
    z
      .string()
      .optional()
      .transform((value) => value === "true"),
    { env: "SCENARIO_VERBOSE" },
  ),
  logContext: Config.value(
    z
      .string()
      .optional()
      .transform((value): ScenarioLogContext => decodeScenarioLogContext(value)),
    { env: "LANGWATCH_LOG_CONTEXT" },
  ),
});

export type ScenarioChildProcessConfig = ConfigValue<typeof scenarioChildProcessConfigDefinition>;

/** Resolves the child executable's explicit environment before it performs work. */
export function resolveScenarioChildProcessConfig(
  source: Readonly<Record<string, unknown>>,
): ScenarioChildProcessConfig {
  return RuntimeConfig.create({
    name: "scenario child process",
    definition: scenarioChildProcessConfigDefinition,
    source,
  }).value;
}

export function requireScenarioChildTelemetry(config: ScenarioChildProcessConfig): {
  langwatchEndpoint: string;
  langwatchApiKey: string;
} {
  if (!config.langwatchEndpoint || !config.langwatchApiKey) {
    throw new Error("LANGWATCH_ENDPOINT and LANGWATCH_API_KEY must be set in child process env");
  }

  return {
    langwatchEndpoint: config.langwatchEndpoint,
    langwatchApiKey: config.langwatchApiKey,
  };
}
