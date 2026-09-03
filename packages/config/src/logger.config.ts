import { z } from "zod";

import { Config, environmentBooleanSchema, RuntimeConfig } from "./runtime-config";

/**
 * The logging knobs every process folds through
 * `@langwatch/observability`'s `loggerConfigurationFrom`, at the deployment's
 * own spelling.
 *
 * All four optional: a process given none logs at the library's own default
 * level and format rather than refusing to start over a logging preference.
 */
export const loggerConfigDefinition = RuntimeConfig.define({
  format: Config.value(z.enum(["pretty", "json"]).optional(), { env: "LOG_FORMAT" }),
  level: Config.value(z.string().min(1).optional(), { env: "LOG_LEVEL" }),
  consoleLevel: Config.value(z.string().min(1).optional(), { env: "LOG_CONSOLE_LEVEL" }),
  otelExportEnabled: Config.value(environmentBooleanSchema.optional(), {
    env: "LOG_OTEL_EXPORT_ENABLED",
  }),
});
