// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The hosted end of Connect (ADR-156): what a self-hosted license calls on
 * LangWatch Cloud, and what it is answered. Every field an install reads is
 * snake_case, because the gateway relays the answer byte for byte.
 */

import { z } from "zod";

/** What the gateway sends: the resolved caller, and the caller's own JSON. */
export const hostedServiceEnvelopeSchema = z.object({
  virtual_key_id: z.string().min(1),
  organization_id: z.string().min(1),
  project_id: z.string(),
  payload: z.unknown(),
});

/**
 * One question's answer, as the hosted route relays it. Mirrors the judge's
 * own verdict; this contract may not name instant-eval's shapes.
 */
const hostedVerdictSchema = z.object({
  questionId: z.string(),
  probability: z.number().optional(),
  score: z.number().optional(),
  label: z.string().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
});

/**
 * The list price is what the customer is charged and all it is told. What the
 * judge cost LangWatch stays on the spend row.
 */
export const hostedClassifyAnswerSchema = z.object({
  verdicts: z.array(hostedVerdictSchema),
  skipped_reason: z.string().optional(),
  input_tokens: z.number(),
  is_text_truncated: z.boolean(),
  charged_usd: z.number(),
});

export const hostedCapAnswerSchema = z.object({
  cap_usd: z.number(),
  maximum_cap_usd: z.number(),
});

export type HostedVerdict = z.infer<typeof hostedVerdictSchema>;
export type HostedClassifyAnswer = z.infer<typeof hostedClassifyAnswerSchema>;
export type HostedCapAnswer = z.infer<typeof hostedCapAnswerSchema>;
