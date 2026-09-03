import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config";

/**
 * The three facts a process states about itself, at the deployment's own
 * spelling.
 *
 * `environment` is the deployment label carried into telemetry attributes and
 * log lines, `nodeEnvironment` is the Node runtime mode every process boots
 * under, and `serviceVersion` is the build identifier a deployment may not
 * have set. None of the three is required: a process given none boots as a
 * `"local"` `"development"` deployment with no reported version.
 */
export const runtimeIdentityConfigDefinition = RuntimeConfig.define({
  environment: Config.value(z.string().min(1).default("local"), { env: "ENVIRONMENT" }),
  nodeEnvironment: Config.value(
    z.enum(["development", "test", "production"]).default("development"),
    { env: "NODE_ENV" },
  ),
  serviceVersion: Config.value(z.string().min(1).optional(), { env: "SERVICE_VERSION" }),
});
