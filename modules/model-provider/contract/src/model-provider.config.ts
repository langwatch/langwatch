import {
  Config,
  compileRuntimeConfig,
  environmentOneOrTrueSchema,
  RuntimeConfig,
  type ConfigValue,
} from "@langwatch/config";
import { z } from "zod";

/**
 * The address fence an outbound provider call is judged by. An unset allowlist is
 * EMPTY, never a wildcard — a fence that stops fencing on an absent variable is the
 * failure this leaf prevents.
 */
export const modelProviderServerConfigDefinition = RuntimeConfig.define({
  blockLocalHttpCalls: Config.value(environmentOneOrTrueSchema, {
    env: "BLOCK_LOCAL_HTTP_CALLS",
  }),
  allowedProxyHosts: Config.value(
    z
      .string()
      .optional()
      .transform((value) =>
        (value ?? "")
          .split(",")
          .map((host) => host.trim())
          .filter((host) => host.length > 0),
      ),
    { env: "ALLOWED_PROXY_HOSTS" },
  ),
  /** The engine address, not the proxy path: the composition root joins them. */
  nlpServiceUrl: Config.value(
    z
      .string()
      .optional()
      .transform((value) => value?.trim() || void 0),
    { env: "LANGWATCH_NLP_SERVICE" },
  ),
  /** The terminal fallback for a target that names no model; blank is not a model. */
  defaultModel: Config.value(
    z
      .string()
      .optional()
      .transform((value) => value?.trim() || void 0),
    { env: "LANGWATCH_DEFAULT_MODEL" },
  ),
});

export type ModelProviderServerConfig = ConfigValue<typeof modelProviderServerConfigDefinition>;

export const modelProviderServerConfigSchema = compileRuntimeConfig(
  modelProviderServerConfigDefinition,
);
