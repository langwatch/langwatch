// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GatewaySpendByRequestTypeQuery } from "@langwatch/gateway-contract";

/**
 * Gateway's spend ledger, read through the share gateway declares with billing (round 37 D5).
 * Spec: enterprise/modules/billing/specs/billing.feature
 */
export abstract class BillingGatewaySpendRepository {
  /** False only where no ledger is composed; a caller then reads no spend rather than zero. */
  abstract isSpendSourceAvailable(): boolean;
  /** One request type's confirmed spend across these tenants, in integer nano-USD. */
  abstract sumSpendNanoUsdByRequestType(input: GatewaySpendByRequestTypeQuery): Promise<number>;
}
