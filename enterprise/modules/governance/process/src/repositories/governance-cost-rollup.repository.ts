// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The cost screen's reads over `governance_cost_rollup_1d` (ADR-128). @see specs/governance/governance-cost-screen.feature */

export const GOVERNANCE_COST_SOURCE = { GATEWAY: "gateway", PULLED: "pulled" } as const;
export const GOVERNANCE_COST_CURRENCY_USD = "USD";
export const GOVERNANCE_COST_ROLLUP_PROJECTION_NAME = "governanceCostRollup";
export const GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST = "2026-08-28";

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

/** One stored version of a cell, as the fold writes it; the key columns lead. */
export interface GovernanceCostRollupRow {
  TenantId: string;
  Day: string;
  CostSource: string;
  IngestionSourceId: string;
  Provider: string;
  Model: string;
  AgentId: string;
  CurrencyCode: string;
  RawActorId: string;
  OrganizationId: string;
  ExactOrEstimate: string;
  AmountNanoUsd: number | null;
  AmountNanoMinor: number;
  TokensInput: number;
  TokensOutput: number;
  TokensCacheRead: number;
  TokensCacheWrite: number;
  RequestCount: number;
  RevisionCount: number;
  PreviousAmountNanoUsd: number | null;
  RevisedAt: number | null;
  LastObservedAt: number;
  PulledItemsJson: string;
  Version: string;
  AppliedEventIds: string[];
  CreatedAt: number;
  LastEventOccurredAt: number;
  EventTimestamp: number;
}

/** The nine sort-key columns that address one cell. */
export type GovernanceCostRollupCellAddress = Pick<
  GovernanceCostRollupRow,
  | "TenantId"
  | "Day"
  | "CostSource"
  | "IngestionSourceId"
  | "Provider"
  | "Model"
  | "AgentId"
  | "CurrencyCode"
  | "RawActorId"
>;

export abstract class GovernanceCostRollupRepository {
  /** Appends a cell version and records its restatement keys in the index beside it. */
  abstract upsert(row: GovernanceCostRollupRow): Promise<void>;

  /** The cell at its surviving version: one row, or none. */
  abstract findCellRows(cell: GovernanceCostRollupCellAddress): Promise<GovernanceCostRollupRow[]>;

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
