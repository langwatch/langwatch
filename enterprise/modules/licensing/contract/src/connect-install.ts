// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The install side of Connect as everything outside the feature reads it
 * (ADR-156, sections 5 and 6): the credential an install presents, the answers
 * the two hosts give it, and what the Settings screens render from.
 */

import { z } from "zod";

import { type ConnectService, CONNECT_SERVICES } from "./connect-services.ts";
import type { LicenseError } from "./license-constants.ts";

/** What an install presents on every call to LangWatch. */
export interface ConnectCredential {
  readonly token: string;
  readonly instanceId: string;
}

/** The seats in use, as the install counts them. */
export interface LicenseSeatCounts {
  readonly members: number;
  readonly liteMembers: number;
}

export const connectSyncAnswerSchema = z.object({
  services: z.array(z.string()),
  /** A reissued license waiting for this install, sent until it is presented. */
  license: z.string().optional(),
});

export interface LicenseSyncAnswer {
  /** The hosted services the registry has the license entitled to. */
  readonly services: string[];
  readonly license?: string;
}

export const connectActivationAnswerSchema = z.object({
  license: z.string().min(1),
  planType: z.string(),
  maxMembers: z.number(),
  expiresAt: z.string(),
  services: z.array(z.string()),
});

/** The license an activation code minted, as it comes back. */
export interface ActivationAnswer {
  readonly license: string;
  readonly planType: string;
  readonly maxMembers: number;
  readonly expiresAt: string;
  readonly services: string[];
}

export const connectBudgetSchema = z.object({
  id: z.string(),
  scope: z.string(),
  window: z.string(),
  cap_usd: z.number(),
  spent_usd: z.number().nullable(),
  remaining_usd: z.number().nullable(),
  on_breach: z.string(),
  period_started_at: z.string(),
  is_contract: z.boolean(),
});

export const connectContractSchema = z.object({
  ...connectBudgetSchema.shape,
  commit_usd: z.number(),
  maximum_cap_usd: z.number(),
  overage_enabled: z.boolean(),
  term_ends_at: z.string().nullable(),
});

/**
 * The published shape of the usage answer. Both halves parse against it, which
 * is what keeps the hosted route and the install from drifting apart.
 */
export const connectUsageAnswerSchema = z.object({
  services: z.array(z.string()),
  spend_available: z.boolean(),
  read_at: z.string(),
  contract: connectContractSchema.nullable(),
  budgets: z.array(connectBudgetSchema),
});

export const connectSetBudgetAnswerSchema = z.object({
  cap_usd: z.number(),
  maximum_cap_usd: z.number(),
});

export const connectVerdictSchema = z.object({
  questionId: z.string(),
  probability: z.number().optional(),
  score: z.number().optional(),
  label: z.string().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
});

export const connectClassifyAnswerSchema = z.object({
  verdicts: z.array(connectVerdictSchema),
  skipped_reason: z.string().optional(),
  input_tokens: z.number(),
  is_text_truncated: z.boolean(),
  charged_usd: z.number(),
});

/** One judged text, as the host answers it. */
export interface ConnectClassifyAnswer {
  readonly verdicts: z.infer<typeof connectVerdictSchema>[];
  readonly skippedReason?: string;
  readonly inputTokens: number;
  readonly isTextTruncated: boolean;
  readonly chargedUsd: number;
}

export interface ConnectBudgetView {
  readonly id: string;
  readonly scope: string;
  readonly window: string;
  readonly capUsd: number;
  readonly spentUsd: number | null;
  readonly remainingUsd: number | null;
  readonly onBreach: string;
  readonly periodStartedAt: string;
  readonly isContract: boolean;
}

export interface ConnectContractView extends ConnectBudgetView {
  readonly commitUsd: number;
  readonly maximumCapUsd: number;
  readonly overageEnabled: boolean;
  readonly termEndsAt: string | null;
}

export interface ConnectUsageView {
  readonly services: string[];
  readonly spendAvailable: boolean;
  readonly readAt: string;
  readonly contract: ConnectContractView | null;
  readonly budgets: ConnectBudgetView[];
}

/** What a refused read came back as, for the page to render its own copy. */
export interface ConnectRefusal {
  readonly code: string;
  readonly meta?: unknown;
}

/** Where the daily license sync stands (ADR-156, section 6). */
export interface ConnectSyncView {
  readonly lastSyncAt: string | null;
  readonly lastError: { readonly code: string } | null;
}

/**
 * What Settings, Connect renders. `deployment: "off"` is the escape hatch an
 * auditor asks for: this install builds no client and makes no outbound call.
 */
export type ConnectStatus =
  | { readonly deployment: "off" }
  | {
      readonly deployment: "on";
      readonly gatewayHost: string;
      readonly licensed: boolean;
      readonly enabledServices: ConnectService[];
      readonly entitledServices: string[] | null;
      readonly usage: ConnectUsageView | null;
      readonly refusal: ConnectRefusal | null;
      readonly sync: ConnectSyncView;
    };

/** What one sync of one organization did with the answer it got back. */
export type LicenseSyncOutcome =
  | { readonly outcome: "unchanged" }
  | { readonly outcome: "updated"; readonly maxMembers: number; readonly expiresAt: string }
  | { readonly outcome: "delivered_invalid"; readonly error: LicenseError };

/**
 * What an administrator pressing "Refresh license" is told. A license the host
 * delivered that does not verify is not applied, and is thrown rather than
 * answered, so the page shows the same refusal the daily pass recorded.
 */
export type LicenseRefreshOutcome = Exclude<
  LicenseSyncOutcome,
  { readonly outcome: "delivered_invalid" }
>;

/** The views above, as the wire carries them. */
export const connectBudgetViewSchema = z.object({
  id: z.string(),
  scope: z.string(),
  window: z.string(),
  capUsd: z.number(),
  spentUsd: z.number().nullable(),
  remainingUsd: z.number().nullable(),
  onBreach: z.string(),
  periodStartedAt: z.string(),
  isContract: z.boolean(),
});

export const connectContractViewSchema = z.object({
  ...connectBudgetViewSchema.shape,
  commitUsd: z.number(),
  maximumCapUsd: z.number(),
  overageEnabled: z.boolean(),
  termEndsAt: z.string().nullable(),
});

export const connectUsageViewSchema = z.object({
  services: z.array(z.string()),
  spendAvailable: z.boolean(),
  readAt: z.string(),
  contract: connectContractViewSchema.nullable(),
  budgets: z.array(connectBudgetViewSchema),
});

export const connectStatusSchema = z.union([
  z.object({ deployment: z.literal("off") }),
  z.object({
    deployment: z.literal("on"),
    gatewayHost: z.string(),
    licensed: z.boolean(),
    enabledServices: z.array(z.enum(CONNECT_SERVICES)),
    entitledServices: z.array(z.string()).nullable(),
    usage: connectUsageViewSchema.nullable(),
    refusal: z.object({ code: z.string(), meta: z.unknown().optional() }).nullable(),
    sync: z.object({
      lastSyncAt: z.string().nullable(),
      lastError: z.object({ code: z.string() }).nullable(),
    }),
  }),
]);

export const connectServicesSetSchema = z.object({
  enabledServices: z.array(z.enum(CONNECT_SERVICES)),
});

export const connectCapSetSchema = z.object({
  capUsd: z.number(),
  maximumCapUsd: z.number(),
});

export const licenseRefreshOutcomeSchema = z.union([
  z.object({ outcome: z.literal("unchanged") }),
  z.object({ outcome: z.literal("updated"), maxMembers: z.number(), expiresAt: z.string() }),
]);

/**
 * The install's identity row, for the usage report and the checkup (ADR-156,
 * section 9). Times are ISO 8601; an absent report field means none was sent.
 */
export interface InstanceIdentityView {
  readonly instanceId: string;
  readonly createdAt: string;
  readonly lastReportAt?: string;
  readonly lastReportError?: string;
  readonly optionalMetricsOptOut: boolean;
  readonly hostnameOptOut: boolean;
  readonly startupNoticeAcknowledgedSchemaVersion: number;
}

/** What the deployment decided about Connect, and whether any license here names a hosted service. */
export interface ConnectDeploymentView {
  /** False where LANGWATCH_CONNECT_DISABLED is set: the install opens no connection to LangWatch. */
  readonly permitted: boolean;
  /** Some organization's license on this install names a hosted service. */
  readonly connected: boolean;
  readonly licenseEndpoint: string;
  readonly gatewayEndpoint: string;
}
