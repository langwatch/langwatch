// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A connected customer's contract terms and seats, and the hosted usage answer billing still reads
 * through licensing (ADR-156). Install-facing fields are snake_case: the gateway relays them as is.
 */

import { z } from "zod";

import { CONNECT_SERVICES, type ConnectService } from "./issued-license.ts";

/**
 * Who the gateway resolved the caller to. Never read from the caller's body: a
 * key that could name another organization would be a claim nothing checks.
 */
export interface HostedCaller {
  virtualKeyId: string;
  organizationId: string;
  projectId: string | null;
}

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

export type HostedBudgetWire = z.infer<typeof hostedBudgetSchema>;
export type HostedContractWire = z.infer<typeof hostedContractSchema>;
export type HostedUsageAnswer = z.infer<typeof hostedUsageAnswerSchema>;
