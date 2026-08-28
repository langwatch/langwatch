import { Config, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

export const workerConfigDefinition = RuntimeConfig.define({
  environment: Config.value(z.string().min(1).default("local"), { env: "ENVIRONMENT" }),
  nodeEnvironment: Config.value(
    z.enum(["development", "test", "production"]).default("development"),
    {
      env: "NODE_ENV",
    },
  ),
});

export type WorkerConfig = ConfigValue<typeof workerConfigDefinition>;

export function resolveWorkerConfig(source: Readonly<Record<string, unknown>>): WorkerConfig {
  return RuntimeConfig.create({
    name: "worker",
    definition: workerConfigDefinition,
    source,
  }).value;
}
