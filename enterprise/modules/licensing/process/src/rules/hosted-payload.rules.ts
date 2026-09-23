/**
 * What a hosted-service call may carry (ADR-156). The body is the install's
 * own JSON, relayed by the gateway untouched, so it is parsed here and never
 * trusted for identity — who the caller is arrives outside it.
 *
 * @see specs/self-hosting/connected-services/hosted-services.feature.draft
 */

import { ValidationError } from "@langwatch/handled-error";
import type { InstantEvalQuestion } from "@langwatch/instant-eval-contract";
import { z } from "zod";

const MAX_QUESTIONS_PER_CALL = 50;

const instructionsSchema = z.string().trim().min(1).max(4_000);

const booleanQuestionSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("boolean"),
  instructions: instructionsSchema,
  criteria: z.tuple([instructionsSchema, instructionsSchema]).optional(),
});

const scoreQuestionSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("score"),
  instructions: instructionsSchema,
  range: z
    .object({ min: z.number().int(), max: z.number().int() })
    .refine(({ min, max }) => max > min, { message: "the maximum must be above the minimum" }),
});

const categoryQuestionSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("category"),
  instructions: instructionsSchema,
  options: z
    .array(z.object({ name: z.string().min(1), description: z.string().min(1) }))
    .min(2),
});

const hostedQuestionSchema = z.discriminatedUnion("kind", [
  booleanQuestionSchema,
  scoreQuestionSchema,
  categoryQuestionSchema,
]);

export const hostedClassifyPayloadSchema = z.object({
  text: z.string().min(1),
  questions: z.array(hostedQuestionSchema).min(1).max(MAX_QUESTIONS_PER_CALL),
});

export const hostedBudgetPayloadSchema = z.object({
  /** The new cap in USD, to the cent. */
  cap_usd: z.number().positive().finite(),
});

export type HostedClassifyPayload = {
  text: string;
  questions: readonly InstantEvalQuestion[];
};

/** The parsed body, or the framework's own field-level refusal. */
export function parseHostedPayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) throw ValidationError.fromZodError(result.error);
  return result.data;
}
