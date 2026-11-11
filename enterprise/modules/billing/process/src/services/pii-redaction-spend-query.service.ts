/**
 * The organization's PII redaction spend for a billing month, in meter units, read across every
 * project it owns (ADR-201 decision 9).
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 */

import { PII_REDACTION_REQUEST_TYPE } from "@langwatch/data-privacy-contract";
import { createLogger } from "@langwatch/observability";

import type { BillableEventsTotalResult } from "../rules/billing-month.rules.ts";
import {
  billingMonthWindowMs,
  nanoUsdToInstantEvalMeterUnits,
} from "../rules/instant-eval-meter.rules.ts";

const logger = createLogger("langwatch:billing:piiRedactionSpendQuery");

/** The peers the read goes through, each one operation wide. */
interface PiiRedactionSpendQueryPeers {
  /** Whether this deployment has the ledger a model call's price is read from. */
  isSpendSourceAvailable(): boolean;
  /** Every project of the organization, archived ones included. */
  listProjectIds(input: { organizationId: string }): Promise<readonly string[]>;
  /** The ledger read, in integer nano-USD, bounded to the month. */
  sumSpendNanoUsdByRequestType(input: {
    tenantIds: readonly string[];
    requestType: string;
    fromMs?: number;
    toMs?: number;
  }): Promise<number>;
}

export class PiiRedactionSpendQueryService {
  private constructor(private readonly peers: PiiRedactionSpendQueryPeers) {}

  static create(peers: PiiRedactionSpendQueryPeers): PiiRedactionSpendQueryService {
    return new PiiRedactionSpendQueryService(peers);
  }

  /** `unavailable` where there is no ledger: "not now", never a zero to checkpoint against. */
  async queryPiiRedactionSpendTotal({
    organizationId,
    billingMonth,
  }: {
    organizationId: string;
    billingMonth: string;
  }): Promise<BillableEventsTotalResult> {
    if (!this.peers.isSpendSourceAvailable()) {
      logger.warn({ organizationId }, "no spend ledger, skipping the PII redaction spend query");

      return { outcome: "unavailable" };
    }

    const nanoUsd = await this.peers.sumSpendNanoUsdByRequestType({
      tenantIds: await this.peers.listProjectIds({ organizationId }),
      requestType: PII_REDACTION_REQUEST_TYPE,
      ...billingMonthWindowMs(billingMonth),
    });

    return { outcome: "counted", total: nanoUsdToInstantEvalMeterUnits(nanoUsd) };
  }
}
