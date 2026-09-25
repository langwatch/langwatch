// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The cost screen's reads over `governance_cost_rollup_1d` (ADR-128). @see specs/governance/governance-cost-screen.feature */

export const GOVERNANCE_COST_SOURCE = { GATEWAY: "gateway", PULLED: "pulled" } as const;
export const GOVERNANCE_COST_CURRENCY_USD = "USD";

/** Inclusive `YYYY-MM-DD` bounds on one tenant's pulled cells. */
export interface GovernanceCostRollupWindow {
  tenantId: string;
  fromDay: string;
  toDay: string;
}

export interface GovernanceCostProviderDayGroup {
  day: string;
  provider: string;
  amountNanoUsd: number | null;
  cellsWithoutAmount: number;
  currenciesWithoutUsdAmount: string[];
}

export interface GovernanceCostPeriodRecordGroup {
  model: string;
  agentId: string;
  amountNanoUsd: number | null;
  cellsWithoutAmount: number;
  currenciesWithoutUsdAmount: string[];
}

export interface GovernanceCostSpenderGroup {
  provider: string;
  /** Empty when the provider named nobody for the row's day. */
  rawActorId: string;
  /** Empty when the provider named no agent. */
  agentId: string;
  amountNanoUsd: number | null;
  cellsWithoutAmount: number;
}

export interface GovernanceCostModelGroup {
  /** Empty when the provider's row named no model. */
  model: string;
  amountNanoUsd: number | null;
  cellsWithoutAmount: number;
}

export abstract class GovernanceCostRollupRepository {
  /** The pulled lane per day and provider, each cell at its surviving version. */
  abstract sumDaysByProvider(
    input: GovernanceCostRollupWindow,
  ): Promise<GovernanceCostProviderDayGroup[]>;

  /** The records behind one period at one provider, one level finer than its figure. */
  abstract sumPeriodRecordsByProvider(
    input: GovernanceCostRollupWindow & { provider: string },
  ): Promise<GovernanceCostPeriodRecordGroup[]>;

  /** The pulled lane per provider, person and agent. */
  abstract sumWindowBySpender(
    input: GovernanceCostRollupWindow,
  ): Promise<GovernanceCostSpenderGroup[]>;

  /** The pulled lane per model. */
  abstract sumWindowByModel(input: GovernanceCostRollupWindow): Promise<GovernanceCostModelGroup[]>;
}
