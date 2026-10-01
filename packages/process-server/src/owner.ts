/**
 * The process-server's own declaration (§6): framework globals declare at
 * their framework owner, with the same primitive a module uses.
 */
import { Config, isSaas } from "@langwatch/config";
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
     * The NLP engine's address. A deployment fact of the process, read by the
     * http surface and by every module that calls the engine.
     */
    nlpServiceUrl: c.env(
      "LANGWATCH_NLP_SERVICE",
      z
        .string()
        .optional()
        .transform((value) => value?.trim() || void 0),
    ),
    /**
     * How long a code block may run inside the engine, raw as the engine reads it.
     * One owner for a fact workflow and scenario both read; each clamps its own way.
     */
    nlpCodeBlockTimeoutSeconds: c.env(
      "NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS",
      z.string().optional(),
    ),
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
     * This deployment's public origin: a process fact drilled to the modules
     * that link back, never a config key each of them declares. Absent and
     * blank both mean "named none", as the composition this replaced answered.
     */
    baseHost: c.env(
      "BASE_HOST",
      z
        .string()
        .optional()
        .transform((value) => value?.trim() || void 0),
    ),
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
} as const;
