/**
 * The process-server's own declaration (§6): framework globals declare at
 * their framework owner, with the same primitive a module uses.
 */
import {
  Config,
  isSaas,
  nlpCodeBlockTimeoutSeconds,
  nlpServiceUrl,
  publicBaseUrl,
} from "@langwatch/config";
import { nlpInternalSecret } from "@langwatch/secrets";
import { z } from "zod";

export const processOwner = {
  name: "process",
  config: Config.define((c) => ({
    /**
     * Routing, not a secret: which 1Password account the secrets chain asks.
     * Absent, the 1Password adapter is inert and env/file answer alone.
     */
    onePasswordAccount: c.env("LANGWATCH_OP_ACCOUNT", z.string().optional()),
    /**
     * The deployment's environment name. A process fact with ONE owner: the
     * http owner derives `production` from it and modules read it as a member,
     * so nothing else may declare `NODE_ENV`.
     */
    nodeEnvironment: c.env("NODE_ENV", z.string().optional()),
    /**
     * Whether this deployment is the hosted product. One owner for a fact five
     * modules read; the eventual signed-licence replacement is then one edit.
     */
    isSaas,
    /**
     * The NLP engine's address: the shared leaf, so a module holding
     * `nlpServiceUrl` in its own slice reads the same fact without a collision.
     */
    nlpServiceUrl,
    /**
     * How long a code block may run inside the engine, raw: the shared leaf, so
     * workflow and scenario holding it too read the same fact without a collision.
     */
    nlpCodeBlockTimeoutSeconds,
    /** Keeps the development badge off a development build (demos, screenshots). */
    hideDevIndicator: c.env(
      "HIDE_DEV_INDICATOR",
      z
        .enum(["0", "1", "false", "true"])
        .optional()
        .transform((value) => value === "1" || value === "true"),
    ),
    /** What the development badge reads instead of "DEV": a haven stack's slug. */
    devIndicatorLabel: c.env(
      "DEV_INDICATOR_LABEL",
      z
        .string()
        .optional()
        .transform((value) => value?.trim() || void 0),
    ),
    /**
     * This deployment's public origin: the shared leaf, so a module holding
     * `publicBaseUrl` in its own slice reads the same fact without a collision.
     */
    baseHost: publicBaseUrl,
    /**
     * The standard proxy spellings, keyed by env name: a process fact handed to
     * every module whose outbound calls follow it, as the `outboundProxy` member.
     */
    outboundProxy: {
      HTTPS_PROXY: c.env("HTTPS_PROXY", z.string().optional()),
      https_proxy: c.env("https_proxy", z.string().optional()),
      HTTP_PROXY: c.env("HTTP_PROXY", z.string().optional()),
      http_proxy: c.env("http_proxy", z.string().optional()),
      NO_PROXY: c.env("NO_PROXY", z.string().optional()),
      no_proxy: c.env("no_proxy", z.string().optional()),
    },
  })),
  secrets: {
    /**
     * The engine hop's shared credential: the shared handle, so a module
     * claiming `nlpInternalSecret` too is admitted rather than refused.
     */
    nlpInternal: nlpInternalSecret,
  },
} as const;
