import { Config, RuntimeConfig, portSchema, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

export const apiConfigDefinition = RuntimeConfig.define({
  environment: Config.value(z.string().min(1).default("local"), { env: "ENVIRONMENT" }),
  host: Config.value(z.string().min(1).default("0.0.0.0"), { env: "API_HOST" }),
  port: Config.value(portSchema.default(5560), { env: "API_PORT" }),
  httpDrainGraceMs: Config.value(z.coerce.number().int().min(0).default(5_000), {
    env: "API_HTTP_DRAIN_GRACE_MS",
  }),
});

export type ApiConfig = ConfigValue<typeof apiConfigDefinition>;

/** Parses executable configuration once, before API services are composed. */
export function resolveApiConfig(source: Readonly<Record<string, unknown>>): ApiConfig {
  return RuntimeConfig.create({
    name: "api",
    definition: apiConfigDefinition,
    source,
  }).value;
}
