// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

/** The contract budget's cap and current window, as gateway's row holds them. */
export type BillingContractBudgetRecord = {
  id: string;
  scopeId: string;
  providerKey: string | null;
  limitUsdCents: number;
  currentPeriodStartedAt: Instant;
};

/**
 * Gateway's `GatewayBudget` rows, read through the share gateway declares with billing (C3a D5, R40).
 * Spec: specs/self-hosting/connected-services/connected-billing.feature
 */
export abstract class BillingContractBudgetRepository {
  /** The organization's live contract budget; empty until connect has synced one. */
  abstract findContractBudget(input: {
    organizationId: string;
  }): Promise<BillingContractBudgetRecord[]>;
}
