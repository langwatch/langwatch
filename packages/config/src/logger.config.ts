import { z } from "zod";

import { Config, environmentBooleanSchema, RuntimeConfig } from "./runtime-config.ts";

/**
 * The logging knobs every process folds through `loggerConfigurationFrom` in
 * `@langwatch/observability`. All four optional: given none, a process logs
 * at the library's own default rather than refusing to start.
 */
export const loggerConfigDefinition = RuntimeConfig.define({
  format: Config.value(z.enum(["pretty", "json"]).optional(), { env: "LOG_FORMAT" }),
  level: Config.value(z.string().min(1).optional(), { env: "LOG_LEVEL" }),
  consoleLevel: Config.value(z.string().min(1).optional(), { env: "LOG_CONSOLE_LEVEL" }),
  otelExportEnabled: Config.value(environmentBooleanSchema.optional(), {
    env: "LOG_OTEL_EXPORT_ENABLED",
  }),
});
