import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config.ts";

/**
 * Process identity facts: `environment` (deployment label for telemetry), `nodeEnvironment`
 * (Node runtime mode), and `serviceVersion` (build identifier). All optional; defaults are
 * `"local"`, `"development"`, and none.
 */
export const runtimeIdentityConfigDefinition = RuntimeConfig.define({
  environment: Config.value(z.string().min(1).default("local"), { env: "ENVIRONMENT" }),
  nodeEnvironment: Config.value(
    z.enum(["development", "test", "production"]).default("development"),
    { env: "NODE_ENV" },
  ),
  serviceVersion: Config.value(z.string().min(1).optional(), { env: "SERVICE_VERSION" }),
});
