/**
 * The process-server's own declaration (§6): framework globals declare at
 * their framework owner, with the same primitive a module uses.
 */
import { Config, environmentOneOrTrueSchema } from "@langwatch/config";
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
    isSaas: c.env("IS_SAAS", environmentOneOrTrueSchema),
    /**
     * The platform-operator list, parsed once. Blank means none rather than
     * refusing boot; several modules read it, so it has one owner here.
     */
    adminEmails: c.env(
      "ADMIN_EMAILS",
      z
        .string()
        .optional()
        .transform((raw) =>
          (raw ?? "")
            .split(",")
            .map((email) => email.trim())
            .filter((email) => email.length > 0),
        ),
    ),
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
  })),
} as const;
