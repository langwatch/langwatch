/**
 * The organization's Instant Eval spend for a billing month, in meter units.
 * Read across every project it owns, because the ledger's tenant is the
 * project the judgement ran in.
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 */

import { INSTANT_EVAL_REQUEST_TYPE } from "@langwatch/instant-eval-judge-contract";
import { createLogger } from "@langwatch/observability";

import type { BillableEventsTotalResult } from "../rules/billing-month.rules.ts";
import {
  instantEvalWindowMs,
  nanoUsdToInstantEvalMeterUnits,
} from "../rules/instant-eval-meter.rules.ts";

const logger = createLogger("langwatch:billing:instantEvalSpendQuery");

/** The peers the read goes through, each one operation wide. */
interface InstantEvalSpendQueryPeers {
  /** Whether this deployment has the ledger a judgement's cost is read from. */
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

export class InstantEvalSpendQueryService {
  private constructor(private readonly peers: InstantEvalSpendQueryPeers) {}

  static create(peers: InstantEvalSpendQueryPeers): InstantEvalSpendQueryService {
    return new InstantEvalSpendQueryService(peers);
  }

  /**
   * `unavailable` where there is no ledger, which the caller treats as "not
   * now" rather than as a verified zero it would checkpoint against.
   * The month starts no earlier than `usageBilledSinceMs` (ADR-174 decision 23, proposed in v22).
   */
  async queryInstantEvalSpendTotal({
    organizationId,
    billingMonth,
    usageBilledSinceMs,
  }: {
    organizationId: string;
    billingMonth: string;
    usageBilledSinceMs: number | null;
  }): Promise<BillableEventsTotalResult> {
    if (!this.peers.isSpendSourceAvailable()) {
      logger.warn({ organizationId }, "no spend ledger, skipping the Instant Eval spend query");

      return { outcome: "unavailable" };
    }

    const nanoUsd = await this.peers.sumSpendNanoUsdByRequestType({
      tenantIds: await this.peers.listProjectIds({ organizationId }),
      requestType: INSTANT_EVAL_REQUEST_TYPE,
      ...instantEvalWindowMs({ billingMonth, usageBilledSinceMs }),
    });

    return { outcome: "counted", total: nanoUsdToInstantEvalMeterUnits(nanoUsd) };
  }
}
