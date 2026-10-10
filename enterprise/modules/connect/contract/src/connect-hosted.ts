// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The hosted end of Connect (ADR-156): what a self-hosted license calls on
 * LangWatch Cloud, and what it is answered. Every field an install reads is
 * snake_case, because the gateway relays the answer byte for byte.
 */

import { CONNECT_SERVICES } from "@langwatch/enterprise-licensing-contract";
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The `externalId` connect writes on the one gateway budget a customer's contract caps. */
export const CONTRACT_BUDGET_EXTERNAL_ID = "connect-contract";

/**
 * Who the gateway resolved the caller to. Never read from the caller's body: a
 * key that could name another organization would be a claim nothing checks.
 */
export interface HostedCaller {
  virtualKeyId: string;
  organizationId: string;
  projectId: string | null;
}

/** What the gateway sends: the resolved caller, and the caller's own JSON. */
const hostedServiceEnvelopeSchemaDefinition = z.object({
  virtual_key_id: z.string().min(1),
  organization_id: z.string().min(1),
  project_id: z.string(),
  payload: z.unknown(),
});
export interface HostedServiceEnvelopeSchema extends Named<
  typeof hostedServiceEnvelopeSchemaDefinition
> {}
export const hostedServiceEnvelopeSchema: HostedServiceEnvelopeSchema =
  hostedServiceEnvelopeSchemaDefinition;

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
const hostedClassifyAnswerSchemaDefinition = z.object({
  verdicts: z.array(hostedVerdictSchema),
  skipped_reason: z.string().optional(),
  input_tokens: z.number(),
  is_text_truncated: z.boolean(),
  charged_usd: z.number(),
});
export interface HostedClassifyAnswerSchema extends Named<
  typeof hostedClassifyAnswerSchemaDefinition
> {}
export const hostedClassifyAnswerSchema: HostedClassifyAnswerSchema =
  hostedClassifyAnswerSchemaDefinition;

const hostedCapAnswerSchemaDefinition = z.object({
  cap_usd: z.number(),
  maximum_cap_usd: z.number(),
});
export interface HostedCapAnswerSchema extends Named<typeof hostedCapAnswerSchemaDefinition> {}
export const hostedCapAnswerSchema: HostedCapAnswerSchema = hostedCapAnswerSchemaDefinition;

const hostedBudgetSchema = z.object({
  id: z.string(),
  scope: z.string(),
  window: z.string(),
  on_breach: z.enum(["block", "warn"]),
  cap_usd: z.number(),
  /** Null when live spend could not be read. Never zero in that case. */
  spent_usd: z.number().nullable(),
  remaining_usd: z.number().nullable(),
  period_started_at: z.string(),
  is_contract: z.boolean(),
});

/** The contract budget, with the commercial terms behind it. */
const hostedContractSchema = z.object({
  ...hostedBudgetSchema.shape,
  commit_usd: z.number(),
  maximum_cap_usd: z.number(),
  overage_enabled: z.boolean(),
  term_ends_at: z.string().nullable(),
});

const hostedUsageAnswerSchemaDefinition = z.object({
  services: z.array(z.enum(CONNECT_SERVICES)),
  spend_available: z.boolean(),
  read_at: z.string(),
  contract: hostedContractSchema.nullable(),
  budgets: z.array(hostedBudgetSchema),
});
export interface HostedUsageAnswerSchema extends Named<typeof hostedUsageAnswerSchemaDefinition> {}
export const hostedUsageAnswerSchema: HostedUsageAnswerSchema = hostedUsageAnswerSchemaDefinition;

export type HostedBudgetWire = z.infer<typeof hostedBudgetSchema>;
export type HostedContractWire = z.infer<typeof hostedContractSchema>;
export type HostedUsageAnswer = z.infer<typeof hostedUsageAnswerSchema>;
export type HostedVerdict = z.infer<typeof hostedVerdictSchema>;
export type HostedClassifyAnswer = z.infer<typeof hostedClassifyAnswerSchema>;
export type HostedCapAnswer = z.infer<typeof hostedCapAnswerSchema>;
