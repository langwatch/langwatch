import { Config, environmentOneOrTrueSchema, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * The address fence an outbound provider call is judged by. An unset allowlist is
 * EMPTY, never a wildcard — a fence that stops fencing on an absent variable is the
 * failure this leaf prevents.
 */
export const modelProviderConfig = Config.define((c) => ({
  blockLocalHttpCalls: c.env("BLOCK_LOCAL_HTTP_CALLS", environmentOneOrTrueSchema),
  allowedProxyHosts: c.env(
    "ALLOWED_PROXY_HOSTS",
    z
      .string()
      .optional()
      .transform((value) =>
        (value ?? "")
          .split(",")
          .map((host) => host.trim())
          .filter((host) => host.length > 0),
      ),
  ),
  /** The terminal fallback for a target that names no model; blank is not a model. */
  defaultModel: c.env(
    "LANGWATCH_DEFAULT_MODEL",
    z
      .string()
      .optional()
      .transform((value) => value?.trim() || void 0),
  ),
}));

export type ModelProviderServerConfig = ConfigOf<typeof modelProviderConfig>;
