/**
 * The organization's PII redaction spend for a billing month, in meter units, read across every
 * project it owns (ADR-201 decision 9), from the moment an organization admin accepted the price
 * only (decision 15).
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 */

import { PII_REDACTION_REQUEST_TYPE } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import { createLogger } from "@langwatch/observability";

import {
  instantEvalWindowMs,
  nanoUsdToInstantEvalMeterUnits,
} from "../rules/instant-eval-meter.rules.ts";

const logger = createLogger("langwatch:billing:piiRedactionSpendQuery");

/** The peers the read goes through, each one operation wide. */
interface PiiRedactionSpendQueryPeers {
  /** Whether this deployment has the ledger a model call's price is read from. */
  isSpendSourceAvailable(): boolean;
  /** Every project of the organization, archived ones included. */
  listProjectIds(input: { organizationId: string }): Promise<readonly string[]>;
  /** When an organization admin accepted the model's price, or null when none did. */
  findPiiRedactionModelAcceptedAtMs(input: { organizationId: string }): Promise<number | null>;
  /** The ledger read, in integer nano-USD, bounded to the month. */
  sumSpendNanoUsdByRequestType(input: {
    tenantIds: readonly string[];
    requestType: string;
    fromMs?: number;
    toMs?: number;
  }): Promise<number>;
}

/** The month's total, and the moment it was read from: the reporter floors a narrowed month. */
type PiiRedactionSpendTotal =
  | { outcome: "counted"; total: number; fromMs: number }
  | { outcome: "unavailable" };

export class PiiRedactionSpendQueryService {
  private constructor(private readonly peers: PiiRedactionSpendQueryPeers) {}

  static create(peers: PiiRedactionSpendQueryPeers): PiiRedactionSpendQueryService {
    return new PiiRedactionSpendQueryService(peers);
  }

  /**
   * `unavailable` where there is no ledger: "not now", never a zero to checkpoint against. The
   * month starts at the latest of `usageBilledSinceMs` (the seat's or price line's, ADR-174
   * decision 26) and the acceptance (ADR-201 decision 15); without an acceptance it is empty.
   */
  async queryPiiRedactionSpendTotal({
    organizationId,
    billingMonth,
    usageBilledSinceMs,
  }: {
    organizationId: string;
    billingMonth: string;
    usageBilledSinceMs: number | null;
  }): Promise<PiiRedactionSpendTotal> {
    if (!this.peers.isSpendSourceAvailable()) {
      logger.warn({ organizationId }, "no spend ledger, skipping the PII redaction spend query");

      return { outcome: "unavailable" };
    }

    // Spend from before an admin accepted the price, which an earlier release recorded without
    // asking, is never billed; with no acceptance there is nothing to count.
    const acceptedAtMs = await this.peers.findPiiRedactionModelAcceptedAtMs({ organizationId });
    const window = instantEvalWindowMs({
      billingMonth,
      usageBilledSinceMs:
        acceptedAtMs === null
          ? Number.POSITIVE_INFINITY
          : Math.max(usageBilledSinceMs ?? acceptedAtMs, acceptedAtMs),
    });
    if (window.fromMs >= window.toMs)
      return { outcome: "counted", total: 0, fromMs: window.fromMs };

    const nanoUsd = await this.peers.sumSpendNanoUsdByRequestType({
      tenantIds: await this.peers.listProjectIds({ organizationId }),
      requestType: PII_REDACTION_REQUEST_TYPE,
      ...window,
    });

    return {
      outcome: "counted",
      total: nanoUsdToInstantEvalMeterUnits(nanoUsd),
      fromMs: window.fromMs,
    };
  }
}
