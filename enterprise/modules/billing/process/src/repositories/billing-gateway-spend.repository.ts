// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GatewaySpendByRequestTypeQuery } from "@langwatch/gateway-contract";

/** One budget bucket's enforced spend since a window opened, across these tenants. */
export type BudgetBucketSpendQuery = {
  tenantIds: string[];
  budgetId: string;
  bucketScopeId: string;
  fromMs: number;
};

/**
 * Gateway's spend ledger and budget ledger, read through the shares gateway declares with billing
 * (round 37 D5; C3a D5).
 * Spec: enterprise/modules/billing/specs/billing.feature
 */
export abstract class BillingGatewaySpendRepository {
  /** False only where no ledger is composed; a caller then reads no spend rather than zero. */
  abstract isSpendSourceAvailable(): boolean;
  /** One request type's confirmed spend across these tenants, in integer nano-USD. */
  abstract sumSpendNanoUsdByRequestType(input: GatewaySpendByRequestTypeQuery): Promise<number>;
  /** The successful debits on one budget bucket, in integer nano-USD: what the gateway enforces. */
  abstract sumBudgetSpendNanoUsd(input: BudgetBucketSpendQuery): Promise<number>;
}
