// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { INSTANT_EVAL_REQUEST_TYPE } from "@langwatch/instant-eval-contract";
import { Temporal } from "@langwatch/time";

import {
  billingMonthWindowMs,
  nanoUsdToInstantEvalMeterUnits,
  usdCentsToInstantEvalMeterUnits,
} from "../rules/instant-eval-meter.rules.ts";

export type ConnectedUsageCeilingPeers = Readonly<{
  licensing: Pick<LicensingApi, "getContractTerms">;
  gateway: Pick<GatewayApi, "isSpendSourceAvailable" | "sumSpendNanoUsdByRequestType">;
  projects: { findProjectIds(organizationId: string): Promise<readonly string[]> };
}>;

/** A connected month's cap in meter units, or none when no term counts or no ledger answers. */
export type ConnectedUsageCeiling =
  | { kind: "capped"; remainingUnits: number }
  | { kind: "uncapped" };

/** What is left of a connected customer's term cap for one month, in meter units (ADR-156 §7). */
export class ConnectedUsageCeilingService {
  static create(peers: ConnectedUsageCeilingPeers): ConnectedUsageCeilingService {
    return new ConnectedUsageCeilingService(peers);
  }

  private constructor(private readonly peers: ConnectedUsageCeilingPeers) {}

  async getRemaining({
    organizationId,
    billingMonth,
  }: {
    organizationId: string;
    billingMonth: string;
  }): Promise<ConnectedUsageCeiling> {
    const terms = await this.peers.licensing.getContractTerms({ organizationId });
    if (terms.termStartsAt === null) return { kind: "uncapped" };
    const ceiling = usdCentsToInstantEvalMeterUnits(
      terms.overageEnabled ? terms.maximumUsdCents : terms.commitUsdCents,
    );

    if (!this.peers.gateway.isSpendSourceAvailable()) return { kind: "uncapped" };
    const earlierNanoUsd = await this.peers.gateway.sumSpendNanoUsdByRequestType({
      tenantIds: await this.peers.projects.findProjectIds(organizationId),
      requestType: INSTANT_EVAL_REQUEST_TYPE,
      fromMs: Temporal.Instant.from(terms.termStartsAt).epochMilliseconds,
      toMs: billingMonthWindowMs(billingMonth).fromMs,
    });
    const earlier = nanoUsdToInstantEvalMeterUnits(earlierNanoUsd);
    return { kind: "capped", remainingUnits: Math.max(0, ceiling - Math.min(earlier, ceiling)) };
  }
}
