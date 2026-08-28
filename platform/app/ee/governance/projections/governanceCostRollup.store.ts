// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";

import type {
  GovernanceCostRollupClickHouseRepository,
  GovernanceCostRollupRow,
} from "../services/governanceCostRollup.clickhouse.repository";
import {
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
  type GovernanceCostSource,
} from "./governanceCostRollup.constants";
import {
  decodeGovernanceCostRollupKey,
  type GovernanceCostRollupState,
  governanceCostRollupTotals,
  type PulledContribution,
} from "./governanceCostRollup.foldProjection";

/** State → row. Exported so a test can assert the projection without a store. */
export function projectGovernanceCostRollupStateToRow({
  state,
  tenantId,
  version,
  appliedEventIds,
}: {
  state: GovernanceCostRollupState;
  tenantId: string;
  version: string;
  appliedEventIds: readonly string[];
}): GovernanceCostRollupRow {
  const totals = governanceCostRollupTotals(state);
  return {
    TenantId: tenantId,
    Day: state.day,
    CostSource: state.costSource,
    IngestionSourceId: state.ingestionSourceId,
    Provider: state.provider,
    Model: state.model,
    AgentId: state.agentId,
    CurrencyCode: state.currencyCode,
    RawActorId: state.rawActorId,
    OrganizationId: state.organizationId,
    ExactOrEstimate: state.exactOrEstimate,
    AmountNanoUsd: totals.amountNanoUsd,
    AmountNanoMinor: totals.amountNanoMinor,
    TokensInput: totals.tokensInput,
    TokensOutput: totals.tokensOutput,
    TokensCacheRead: totals.tokensCacheRead,
    TokensCacheWrite: totals.tokensCacheWrite,
    RequestCount: totals.requestCount,
    RevisionCount: state.revisionCount,
    PreviousAmountNanoUsd: state.previousAmountNanoUsd,
    PulledItemsJson: JSON.stringify(state.pulledItems),
    Version: version,
    AppliedEventIds: [...appliedEventIds],
    CreatedAt: state.createdAt,
    LastEventOccurredAt: state.LastEventOccurredAt,
    EventTimestamp: state.updatedAt,
  };
}

/** Row → state, the inverse. */
export function governanceCostRollupStateFromRow(
  row: GovernanceCostRollupRow,
): GovernanceCostRollupState {
  const pulledItems = decodePulledItems(row.PulledItemsJson);
  const pulledAmount = Object.values(pulledItems).reduce(
    (sum, item) => sum + item.amountNanoMinor,
    0,
  );
  const pulledTokens = Object.values(pulledItems).reduce(
    (acc, item) => ({
      input: acc.input + item.tokensInput,
      output: acc.output + item.tokensOutput,
      cacheRead: acc.cacheRead + item.tokensCacheRead,
      cacheWrite: acc.cacheWrite + item.tokensCacheWrite,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
  const pulledCount = Object.keys(pulledItems).length;
  return {
    day: row.Day,
    costSource: row.CostSource as GovernanceCostSource,
    ingestionSourceId: row.IngestionSourceId,
    provider: row.Provider,
    model: row.Model,
    agentId: row.AgentId,
    currencyCode: row.CurrencyCode,
    rawActorId: row.RawActorId,
    organizationId: row.OrganizationId,
    exactOrEstimate:
      row.ExactOrEstimate as GovernanceCostRollupState["exactOrEstimate"],
    // The gateway lane's share is what the row's totals hold beyond the pulled
    // items it also carries. The two lanes never share a row (CostSource is in
    // the key), so exactly one of these is non-zero on any real row; the
    // subtraction is what makes the round-trip exact either way.
    gatewayAmountNanoMinor: row.AmountNanoMinor - pulledAmount,
    gatewayTokensInput: row.TokensInput - pulledTokens.input,
    gatewayTokensOutput: row.TokensOutput - pulledTokens.output,
    gatewayTokensCacheRead: row.TokensCacheRead - pulledTokens.cacheRead,
    gatewayTokensCacheWrite: row.TokensCacheWrite - pulledTokens.cacheWrite,
    gatewayRequestCount: row.RequestCount - pulledCount,
    pulledItems,
    revisionCount: row.RevisionCount,
    previousAmountNanoUsd: row.PreviousAmountNanoUsd,
    createdAt: row.CreatedAt,
    updatedAt: row.EventTimestamp,
    LastEventOccurredAt: row.LastEventOccurredAt,
  };
}

function decodePulledItems(json: string): Record<string, PulledContribution> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, PulledContribution>)
      : {};
  } catch {
    // A row whose item map will not parse cannot be folded onto: doing so
    // would drop every earlier observation and re-add the next one on top of
    // nothing. Answering with an empty map here would be exactly that, so the
    // caller's version gate has to see this as a refusal instead.
    throw new Error(
      "governance_cost_rollup_1d row carries an undecodable PulledItemsJson",
    );
  }
}

/**
 * `FoldProjectionStore` adapter for the daily cost rollup.
 *
 * The store is addressed by the fold's KEY — the day x dimension cell — not by
 * the event's aggregate id, so it decodes the cell out of the key and reads
 * the one row that key names. That is also why the cell has to be recoverable
 * from the key at all: see `governanceCostRollupKey`.
 *
 * `getWithApplied` is not optional here. Queue delivery is at-least-once and
 * this fold ACCUMULATES: a retry that reaches a cold cache with no record of
 * what the previous attempt applied re-adds the same money to the same cell,
 * and the row silently doubles. The applied-event-id set (00054's precedent)
 * rides on the row next to the state, so the dedup survives cache loss.
 */
export class GovernanceCostRollupStore
  implements FoldProjectionStore<GovernanceCostRollupState>
{
  constructor(
    private readonly repo: GovernanceCostRollupClickHouseRepository,
  ) {}

  async store(
    state: GovernanceCostRollupState,
    context: ProjectionStoreContext,
  ): Promise<void> {
    await this.repo.upsert(
      projectGovernanceCostRollupStateToRow({
        state,
        tenantId: String(context.tenantId),
        version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
        appliedEventIds: context.appliedEventIds ?? [],
      }),
    );
  }

  async getWithApplied(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: GovernanceCostRollupState | null;
    appliedEventIds: string[];
    miss?: "absent" | "undecodable";
  }> {
    const cell = decodeGovernanceCostRollupKey(context.key ?? aggregateId);
    const row = await this.repo.findCellWithApplied(cell);
    if (!row) return { state: null, appliedEventIds: [], miss: "absent" };
    // A row this build's shape cannot decode is reported as FOUND-and-refused,
    // never as absent. The fold has no re-fold path on purpose (the executor's
    // replay loads by the event's aggregate, which is one request, not this
    // day-wide cell), so the executor answers `undecodable` by throwing —
    // which is what a money table should do rather than quietly committing a
    // partial total stamped at the current version. A shape change here is a
    // table rebuild, not a self-healing deploy.
    if (row.Version !== GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST) {
      return { state: null, appliedEventIds: [], miss: "undecodable" };
    }
    return {
      state: governanceCostRollupStateFromRow(row),
      appliedEventIds: row.AppliedEventIds,
    };
  }

  /** State only; delegates so the two paths cannot diverge. */
  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<GovernanceCostRollupState | null> {
    return (await this.getWithApplied(aggregateId, context)).state;
  }
}
