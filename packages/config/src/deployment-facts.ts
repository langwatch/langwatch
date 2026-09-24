/**
 * Deployment facts several owners read (ARCHITECTURE.md §6, layer 3). Each is
 * ONE leaf, imported by instance: the parse admits a re-bound variable only
 * when every claimant holds that same leaf.
 */
import { z } from "zod";

import { Config } from "./config.ts";
import { environmentOneOrTrueSchema } from "./env-schemas.ts";

const positiveInteger = z.coerce.number().int().positive();

export const { langevalsStagingThresholdBytes, langevalsStagingTtlSeconds } = Config.define(
  (c) => ({
    /** Unset keeps every payload inline: only a Lambda-fronted langevals has a body cap. */
    langevalsStagingThresholdBytes: c.env(
      "LANGEVALS_STAGING_THRESHOLD_BYTES",
      positiveInteger.optional(),
    ),
    /** How long a staged payload's signed URL stays valid; short, so a leaked URL lapses. */
    langevalsStagingTtlSeconds: c.env(
      "LANGEVALS_STAGING_TTL_SECONDS",
      positiveInteger.default(600),
    ),
  }),
);

/** The outbound address fence every egress-making owner judges a call by. */
export const { blockLocalHttpCalls, allowedProxyHosts } = Config.define((c) => ({
  blockLocalHttpCalls: c.env("BLOCK_LOCAL_HTTP_CALLS", environmentOneOrTrueSchema),
  /** An unset allowlist is EMPTY, never a wildcard. */
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
}));

/** The terminal fallback for a target that names no model; blank is not a model. */
export const { langwatchDefaultModel } = Config.define((c) => ({
  langwatchDefaultModel: c.env(
    "LANGWATCH_DEFAULT_MODEL",
    z
      .string()
      .optional()
      .transform((value) => value?.trim() || void 0),
  ),
}));
