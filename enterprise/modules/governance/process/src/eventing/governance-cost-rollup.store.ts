// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Port of main's `governanceCostRollup.store.ts`: the fold's state to and from one stored cell version. */
import type {
  FoldProjectionStore,
  FoldStateRead,
  ProjectionStoreContext,
} from "@langwatch/eventing";
import { z } from "zod";

import {
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
  GOVERNANCE_COST_SOURCE,
  type GovernanceCostRollupRepository,
  type GovernanceCostRollupRow,
} from "../repositories/governance-cost-rollup.repository.ts";
import {
  decodeGovernanceCostRollupKey,
  type GovernanceCostRollupState,
  governanceCostRollupTotals,
} from "../rules/governance-cost-rollup-cell.rules.ts";

const pulledItemsSchema = z.record(
  z.string(),
  z.object({
    amountNanoMinor: z.number(),
    amountNanoUsd: z.number().nullable().optional(),
    observedAtMs: z.number(),
    priorAmountNanoMinor: z.number().optional(),
    priorAmountNanoUsd: z.number().nullable().optional(),
    priorObservedAtMs: z.number().optional(),
    revisedAtMs: z.number().optional(),
    tokensInput: z.number(),
    tokensOutput: z.number(),
    tokensCacheRead: z.number(),
    tokensCacheWrite: z.number(),
    exactOrEstimate: z.enum(["exact", "estimate"]),
  }),
);
const costSourceSchema = z.enum([GOVERNANCE_COST_SOURCE.GATEWAY, GOVERNANCE_COST_SOURCE.PULLED]);
const exactOrEstimateSchema = z.enum(["exact", "estimate"]);

const toUnixSeconds = (epochMs: number): number => Math.floor(epochMs / 1000);

export function governanceCostRollupRowOf({
  state,
  tenantId,
  appliedEventIds,
}: {
  state: GovernanceCostRollupState;
  tenantId: string;
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
    RevisedAt: state.revisedAt === null ? null : toUnixSeconds(state.revisedAt),
    LastObservedAt: toUnixSeconds(state.lastObservedAt),
    PulledItemsJson: JSON.stringify(state.pulledItems),
    Version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
    AppliedEventIds: [...appliedEventIds],
    CreatedAt: state.createdAt,
    LastEventOccurredAt: state.LastEventOccurredAt,
    EventTimestamp: state.updatedAt,
  };
}

/** Throws on an undecodable item map: a money row read as empty would be overwritten. */
export function governanceCostRollupStateOf(
  row: GovernanceCostRollupRow,
): GovernanceCostRollupState {
  const items = row.PulledItemsJson
    ? pulledItemsSchema.safeParse(parseJson(row.PulledItemsJson))
    : null;
  if (items && !items.success) {
    throw new Error("governance_cost_rollup_1d row carries an undecodable PulledItemsJson");
  }
  const costSource = costSourceSchema.safeParse(row.CostSource);
  const exactOrEstimate = exactOrEstimateSchema.safeParse(row.ExactOrEstimate);
  return {
    day: row.Day,
    costSource: costSource.success ? costSource.data : "",
    ingestionSourceId: row.IngestionSourceId,
    provider: row.Provider,
    model: row.Model,
    agentId: row.AgentId,
    currencyCode: row.CurrencyCode,
    rawActorId: row.RawActorId,
    organizationId: row.OrganizationId,
    exactOrEstimate: exactOrEstimate.success ? exactOrEstimate.data : "",
    pulledItems: items?.data ?? {},
    revisionCount: row.RevisionCount,
    previousAmountNanoUsd: row.PreviousAmountNanoUsd,
    revisedAt: row.RevisedAt === null ? null : row.RevisedAt * 1000,
    lastObservedAt: row.LastObservedAt * 1000,
    createdAt: row.CreatedAt,
    updatedAt: row.EventTimestamp,
    LastEventOccurredAt: row.LastEventOccurredAt,
  };
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/** A version other than the latest reads as `undecodable`, so the executor throws rather than folding onto empty. */
export class GovernanceCostRollupStore implements FoldProjectionStore<GovernanceCostRollupState> {
  private constructor(private readonly rollup: GovernanceCostRollupRepository) {}

  static create(rollup: GovernanceCostRollupRepository): GovernanceCostRollupStore {
    return new GovernanceCostRollupStore(rollup);
  }

  async store(state: GovernanceCostRollupState, context: ProjectionStoreContext): Promise<void> {
    await this.rollup.upsert(
      governanceCostRollupRowOf({
        state,
        tenantId: String(context.tenantId),
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
    const [row] = await this.rollup.findCellRows({
      TenantId: cell.tenantId,
      Day: cell.day,
      CostSource: cell.costSource,
      IngestionSourceId: cell.ingestionSourceId,
      Provider: cell.provider,
      Model: cell.model,
      AgentId: cell.agentId,
      CurrencyCode: cell.currencyCode,
      RawActorId: cell.rawActorId,
    });
    if (!row) return { state: null, appliedEventIds: [], miss: "absent" };
    if (row.Version !== GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST) {
      return { state: null, appliedEventIds: [], miss: "undecodable" };
    }
    return { state: governanceCostRollupStateOf(row), appliedEventIds: row.AppliedEventIds };
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<FoldStateRead<GovernanceCostRollupState>> {
    const { state } = await this.getWithApplied(aggregateId, context);
    return state === null ? { kind: "empty" } : { kind: "folded", state };
  }
}
