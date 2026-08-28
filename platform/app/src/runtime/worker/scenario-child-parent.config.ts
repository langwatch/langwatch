import { Config, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

const scenarioChildParentEnvironmentDefinition = RuntimeConfig.define({
  path: Config.value(z.string().optional(), { env: "PATH" }),
  home: Config.value(z.string().optional(), { env: "HOME" }),
  user: Config.value(z.string().optional(), { env: "USER" }),
  shell: Config.value(z.string().optional(), { env: "SHELL" }),
  lang: Config.value(z.string().optional(), { env: "LANG" }),
  lcAll: Config.value(z.string().optional(), { env: "LC_ALL" }),
  term: Config.value(z.string().optional(), { env: "TERM" }),
  nodeCompileCache: Config.value(z.string().optional(), { env: "NODE_COMPILE_CACHE" }),
  corepackEnableDownloadPrompt: Config.value(z.string().optional(), {
    env: "COREPACK_ENABLE_DOWNLOAD_PROMPT",
  }),
  nodeExtraCaCerts: Config.value(z.string().optional(), { env: "NODE_EXTRA_CA_CERTS" }),
});

export type ScenarioChildParentEnvironment = ConfigValue<
  typeof scenarioChildParentEnvironmentDefinition
>;

export function resolveScenarioChildParentEnvironment(
  source: Readonly<Record<string, unknown>>,
): ScenarioChildParentEnvironment {
  return RuntimeConfig.create({
    name: "scenario child parent environment",
    definition: scenarioChildParentEnvironmentDefinition,
    source,
  }).value;
}
