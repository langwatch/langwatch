import { Config, type ConfigOf, isSaas } from "@langwatch/config";
import { z } from "zod";

/**
 * The cloud classifier's settings, owned by the judge with its client (ADR-174 decision 13).
 * `JEV_API_KEY` resolves through `InstantEvalJudgeModule.secrets` (ADR-132), never this slice.
 */
export const instantEvalJudgeConfig = Config.define((c) => ({
  /** HTTPS only: the judge key travels in a header, so plaintext would send it in the clear. */
  classifierBaseUrl: c.env(
    "JEV_BASE_URL",
    z
      .string()
      .url()
      .refine((value) => value.startsWith("https://"), { message: "JEV_BASE_URL must use https" })
      .optional(),
  ),
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
  /** LangWatch cloud: the only install a judge call is answered on (ADR-174 decision 14). */
  isSaas,
}));

export type InstantEvalJudgeServerConfig = ConfigOf<typeof instantEvalJudgeConfig>;
