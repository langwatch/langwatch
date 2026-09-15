/**
 * The input shapes the custom model-cost tRPC surface parses.
 *
 * Two of them carry a caller-supplied `regex`, accepted only when the pattern
 * compiles and is free of catastrophic backtracking. The factories stay
 * parameterized so a caller with its own predicate can still build the shape;
 * the declared schemas below run the contract's own check.
 */
import { z } from "zod";
import { isSafeCostRegex } from "./model-cost.ts";
import { modelProviderScopeTypeSchema } from "./model-provider.ts";

export const MODEL_COST_UNSAFE_REGEX_MESSAGE =
  "Invalid or unsafe regular expression (avoid nested quantifiers like (a+)+)";

/** The predicate the two regex-bearing shapes are parameterized by. */
export type ModelCostRegexSafetyCheck = Readonly<{
  isSafeRegex(pattern: string): boolean;
}>;

export const modelCostProjectTrpcInputSchema = z.object({
  projectId: z.string(),
});

export const modelCostDeleteTrpcInputSchema = z.object({
  projectId: z.string(),
  id: z.string(),
});

export const modelCostModelLimitsTrpcInputSchema = z.object({
  projectId: z.string(),
  model: z.string(),
});

export function createModelCostWriteTrpcInputSchema({ isSafeRegex }: ModelCostRegexSafetyCheck) {
  const safeRegexSchema = z.string().refine((value) => isSafeRegex(value), {
    message: MODEL_COST_UNSAFE_REGEX_MESSAGE,
  });

  return z.object({
    id: z.string().optional(),
    projectId: z.string(),
    // Optional scope target. Defaults to the page's own project so the
    // existing project-level flow keeps working unchanged; an org admin
    // can pass ORGANIZATION/TEAM to push a cost down the cascade.
    scopeType: modelProviderScopeTypeSchema.optional(),
    scopeId: z.string().optional(),
    model: z.string(),
    inputCostPerToken: z.number().optional(),
    outputCostPerToken: z.number().optional(),
    cacheReadCostPerToken: z.number().optional(),
    cacheCreationCostPerToken: z.number().optional(),
    cacheCreation1hCostPerToken: z.number().optional(),
    regex: safeRegexSchema,
  });
}

export function createModelCostPreviewTrpcInputSchema({ isSafeRegex }: ModelCostRegexSafetyCheck) {
  return z.object({
    projectId: z.string(),
    model: z.string().max(512).optional(),
    regex: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => isSafeRegex(value), {
        message: MODEL_COST_UNSAFE_REGEX_MESSAGE,
      }),
    inputCostPerToken: z.number().nonnegative().optional(),
    outputCostPerToken: z.number().nonnegative().optional(),
    cacheReadCostPerToken: z.number().nonnegative().optional(),
    cacheCreationCostPerToken: z.number().nonnegative().optional(),
    cacheCreation1hCostPerToken: z.number().nonnegative().optional(),
  });
}

/**
 * The two regex-bearing shapes, built once against the contract's own safety
 * check — the same compile-and-check the pricing path runs, so the verdict a
 * caller reads is unchanged by the predicate no longer being a process port.
 */
export const modelCostWriteTrpcInputSchema = createModelCostWriteTrpcInputSchema({
  isSafeRegex: isSafeCostRegex,
});

export const modelCostPreviewTrpcInputSchema = createModelCostPreviewTrpcInputSchema({
  isSafeRegex: isSafeCostRegex,
});
