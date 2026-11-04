import { Config, type ConfigOf, isSaas, nodeEnvironment } from "@langwatch/config";
import { z } from "zod";

import {
  instantEvalJudgeRoutePricingSchema,
  instantEvalJudgeRouteTableSchema,
} from "./instant-eval-judge-route.ts";

/** A JSON-valued variable read through `schema`; unset reads as undefined. */
function jsonEnvOf<T extends z.ZodType>(schema: T) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (!raw?.trim()) return void 0;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "is not valid JSON" });
        return z.NEVER;
      }
    })
    .pipe(schema.optional());
}

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
  /** The router's route table (JSON); unset, every slot asks the hosted classifier alone. */
  judgeRoutes: c.env("INSTANT_EVAL_JUDGE_ROUTES", jsonEnvOf(instantEvalJudgeRouteTableSchema)),
  /** Per-backend prices for routed calls (JSON); unset, the hosted classifier's published rate. */
  judgeRoutePricing: c.env(
    "INSTANT_EVAL_JUDGE_PRICING",
    jsonEnvOf(instantEvalJudgeRoutePricingSchema),
  ),
  /** LangWatch cloud: an install a judge call is answered on (ADR-174 decision 14). */
  isSaas,
  /** "development" marks a repository checkout, which judges with LangWatch's key too. */
  nodeEnvironment,
}));

export type InstantEvalJudgeServerConfig = ConfigOf<typeof instantEvalJudgeConfig>;
