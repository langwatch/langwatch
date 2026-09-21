import { Config, type ConfigOf } from "@langwatch/config";
import { Secret } from "@langwatch/secrets/secret";
import { z } from "zod";

/**
 * What the judge costs and how fast it may be asked. `JEV_API_KEY` resolves
 * through `InstantEvalApp.secrets` (ADR-132), never this slice: a deployment
 * with no key judges nothing, which the null judge answers by name.
 */
export const instantEvalConfig = Config.define((c) => ({
  /** "jev" or "null"; "null" switches judging off outright. */
  classifier: c.env("INSTANT_EVAL_CLASSIFIER", z.enum(["jev", "null"]).optional()),
  classifierBaseUrl: c.env("JEV_BASE_URL", z.string().optional()),
  classifierModel: c.env("JEV_MODEL", z.string().optional()),
  /** Input tokens per second the whole deployment may send. */
  globalTokensPerSecond: c.env(
    "INSTANT_EVAL_GLOBAL_TOKENS_PER_SECOND",
    z.coerce.number().positive().default(300_000),
  ),
  /** Input tokens per second one project may send. */
  tenantTokensPerSecond: c.env(
    "INSTANT_EVAL_TENANT_TOKENS_PER_SECOND",
    z.coerce.number().positive().default(150_000),
  ),
  /** Input tokens one synchronous query may send. */
  queryTokenBudget: c.env(
    "INSTANT_EVAL_QUERY_TOKEN_BUDGET",
    z.coerce.number().positive().default(4_000_000),
  ),
}));

export type InstantEvalServerConfig = ConfigOf<typeof instantEvalConfig>;

export const instantEvalSecrets = {
  classifierApiKey: Secret.load("JEV_API_KEY", { optional: true }),
} as const;
