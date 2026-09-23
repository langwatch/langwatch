// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The hosted end of Connect (ADR-156): what a self-hosted license calls on
 * LangWatch Cloud, and what it is answered.
 *
 * Every field an install reads is snake_case, because the gateway relays the
 * answer byte for byte and the install's own SDK reads it.
 */

import { z } from "zod";

import { CONNECT_SERVICES, type ConnectService } from "./connect-services.ts";

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
export const hostedServiceEnvelopeSchema = z.object({
  virtual_key_id: z.string().min(1),
  organization_id: z.string().min(1),
  project_id: z.string(),
  payload: z.unknown(),
});

/**
 * What a customer's licenses add up to commercially. The budget spans
 * licenses, so the terms do too.
 */
export interface ContractTerms {
  /** Prepaid usage across the customer's licenses. The default cap. */
  commitUsdCents: number;
  /** The highest cap the customer may set: the commit plus agreed overage. */
  maximumUsdCents: number;
  overageEnabled: boolean;
  /** Hosted services any of the counted licenses is entitled to. */
  services: ConnectService[];
  /** ISO instant the last of the counted terms ends, or null when none counts. */
  termEndsAt: string | null;
  /** ISO instant the first of the counted terms began, or null. */
  termStartsAt: string | null;
}

/** The seats a connected customer holds, read off its longest-running active license. */
export interface ConnectedSeats {
  licensed: number;
  /** Members the install last reported; null until it has synced. */
  reported: number | null;
  /** ISO instant of the latest sync of any active license, or null. */
  lastSyncAt: string | null;
  /** The managed gateway key the customer's hosted calls run under, once one resolved. */
  managedVirtualKeyId: string | null;
}

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

export const hostedUsageAnswerSchema = z.object({
  services: z.array(z.enum(CONNECT_SERVICES)),
  spend_available: z.boolean(),
  read_at: z.string(),
  contract: hostedContractSchema.nullable(),
  budgets: z.array(hostedBudgetSchema),
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

export type HostedBudgetWire = z.infer<typeof hostedBudgetSchema>;
export type HostedContractWire = z.infer<typeof hostedContractSchema>;
export type HostedUsageAnswer = z.infer<typeof hostedUsageAnswerSchema>;
export type HostedVerdict = z.infer<typeof hostedVerdictSchema>;
export type HostedClassifyAnswer = z.infer<typeof hostedClassifyAnswerSchema>;
export type HostedCapAnswer = z.infer<typeof hostedCapAnswerSchema>;
