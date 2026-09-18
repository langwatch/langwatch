// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The metered lane's read side: the gateway's own per-request billing ledger,
 * `gateway_spend` (migration 00067). Not yet named in `governance.members.ts`
 * — this module declares the reader itself, same as every repository whose
 * interface has no earlier home.
 */
export interface GovernanceGatewaySpendWindow {
  /** Every project tenant of the viewer's organization. Empty resolves to
   *  no query and no rows, never to an unfiltered read. */
  tenantIds: string[];
  /** Inclusive, `YYYY-MM-DD`. */
  fromDay: string;
  /** Inclusive, `YYYY-MM-DD`. */
  toDay: string;
}

/** One UTC day of metered spend. */
export interface GovernanceGatewaySpendDayRow {
  /** `YYYY-MM-DD`, the day the requests STARTED in UTC. */
  day: string;
  /** Nano-USD summed over the day's charged requests. */
  amountNanoUsd: number;
  /** Charged (confirmed + failed) requests on the day. */
  requestCount: number;
  /** Charged requests with a positive cost. Zero with `requestCount` above
   *  zero means every charged request priced at zero. */
  pricedRequestCount: number;
  /** Requests carrying no dollar amount: zero-cost-with-tokens plus settled. */
  requestsWithoutAmount: number;
}

/** One model's or one virtual key's window total. */
export interface GovernanceGatewaySpendModelRow {
  model: string;
  amountNanoUsd: number;
  requestCount: number;
  pricedRequestCount: number;
  requestsWithoutAmount: number;
}

export interface GovernanceGatewaySpendVirtualKeyRow {
  virtualKeyId: string;
  amountNanoUsd: number;
  requestCount: number;
  pricedRequestCount: number;
  requestsWithoutAmount: number;
}

export abstract class GatewaySpendRepository {
  /**
   * Per-day metered spend across every project tenant of the organization.
   *
   * The day is `toDate(RequestOccurredAt, 'UTC')` — admission time, the day
   * the caller asked — so a streamed answer running across midnight lands
   * whole on the day it started rather than being split by the server's own
   * timezone.
   */
  abstract sumDaysForOrganizationProjects(
    input: GovernanceGatewaySpendWindow,
  ): Promise<GovernanceGatewaySpendDayRow[]>;

  /**
   * The window's metered spend per model, exactly as the ledger named it.
   *
   * A breakdown reader today, not wired into the screen: ADR-128 reserves
   * the metered breakdowns and this is the read they will use. Grouped on
   * the model string verbatim — nothing is re-cut here.
   */
  abstract sumWindowByModel(
    input: GovernanceGatewaySpendWindow,
  ): Promise<GovernanceGatewaySpendModelRow[]>;

  /** The window's metered spend per virtual key. Never by person. */
  abstract sumWindowByVirtualKey(
    input: GovernanceGatewaySpendWindow,
  ): Promise<GovernanceGatewaySpendVirtualKeyRow[]>;
}
