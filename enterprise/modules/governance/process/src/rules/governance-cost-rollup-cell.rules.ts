// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Port of main's `governanceCostRollup.foldProjection.ts` pure half (ADR-128). @see specs/governance/governance-cost-rollup.feature */
import { Temporal } from "@langwatch/time";

import {
  GOVERNANCE_COST_CURRENCY_USD,
  GOVERNANCE_COST_SOURCE,
} from "../repositories/governance-cost-rollup.repository.ts";

export type GovernanceCostSource =
  (typeof GOVERNANCE_COST_SOURCE)[keyof typeof GOVERNANCE_COST_SOURCE];

/** One provider item's newest observation; the prior* fields exist only once its figure moved. */
export interface PulledContribution {
  amountNanoMinor: number;
  amountNanoUsd?: number | null;
  observedAtMs: number;
  priorAmountNanoMinor?: number;
  priorAmountNanoUsd?: number | null;
  priorObservedAtMs?: number;
  revisedAtMs?: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  exactOrEstimate: "exact" | "estimate";
}

/** One day x dimension cell; the identity fields mirror the table's sort key exactly. */
export interface GovernanceCostRollupState {
  day: string;
  costSource: GovernanceCostSource | "";
  ingestionSourceId: string;
  provider: string;
  model: string;
  agentId: string;
  currencyCode: string;
  rawActorId: string;
  organizationId: string;
  exactOrEstimate: "" | "exact" | "estimate";
  pulledItems: Record<string, PulledContribution>;
  revisionCount: number;
  previousAmountNanoUsd: number | null;
  revisedAt: number | null;
  lastObservedAt: number;
  createdAt: number;
  updatedAt: number;
  LastEventOccurredAt: number;
}

export interface GovernanceCostRollupCell {
  tenantId: string;
  day: string;
  costSource: GovernanceCostSource;
  ingestionSourceId: string;
  provider: string;
  model: string;
  agentId: string;
  currencyCode: string;
  rawActorId: string;
}

/** In sort-key order: the table's ORDER BY and the read side's KEY_COLUMNS are the same contract. */
export const GOVERNANCE_COST_ROLLUP_KEY_FIELDS = [
  "tenantId",
  "day",
  "costSource",
  "ingestionSourceId",
  "provider",
  "model",
  "agentId",
  "currencyCode",
  "rawActorId",
] as const satisfies readonly (keyof GovernanceCostRollupCell)[];

/** The UTC calendar day an instant belongs to, `YYYY-MM-DD`. */
export function utcDayOf(occurredAtMs: number): string {
  return Temporal.Instant.fromEpochMilliseconds(occurredAtMs).toString().slice(0, 10);
}

/** Decodable and unambiguous: the whole tuple as base64url JSON behind a readable prefix. */
export function encodeGovernanceCostRollupKey(cell: GovernanceCostRollupCell): string {
  const payload = Buffer.from(
    JSON.stringify(GOVERNANCE_COST_ROLLUP_KEY_FIELDS.map((field) => cell[field])),
    "utf8",
  ).toString("base64url");
  return `cost1d:${cell.tenantId}:${cell.day}:${cell.costSource}:${payload}`;
}

function isGovernanceCostSource(value: string): value is GovernanceCostSource {
  return value === GOVERNANCE_COST_SOURCE.GATEWAY || value === GOVERNANCE_COST_SOURCE.PULLED;
}

function parseKeyTuple(payload: string): unknown {
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

/** Throws rather than guessing: a partial address would overwrite another cell. */
export function decodeGovernanceCostRollupKey(key: string): GovernanceCostRollupCell {
  const tuple = parseKeyTuple(key.slice(key.lastIndexOf(":") + 1));
  if (
    !Array.isArray(tuple) ||
    tuple.length !== GOVERNANCE_COST_ROLLUP_KEY_FIELDS.length ||
    !tuple.every((value): value is string => typeof value === "string")
  ) {
    throw new Error(`Undecodable governance cost rollup key: ${key}`);
  }
  const [tenantId, day, costSource, ingestionSourceId, provider, model, agentId, currencyCode] =
    tuple;
  const rawActorId = tuple[8];
  if (costSource === undefined || !isGovernanceCostSource(costSource) || rawActorId === undefined) {
    throw new Error(`Undecodable governance cost rollup key: ${key}`);
  }
  return {
    tenantId: tenantId ?? "",
    day: day ?? "",
    costSource,
    ingestionSourceId: ingestionSourceId ?? "",
    provider: provider ?? "",
    model: model ?? "",
    agentId: agentId ?? "",
    currencyCode: currencyCode ?? "",
    rawActorId,
  };
}

export interface GovernanceCostRollupTotals {
  amountNanoUsd: number | null;
  amountNanoMinor: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  requestCount: number;
}

export function governanceCostRollupTotals(
  state: GovernanceCostRollupState,
): GovernanceCostRollupTotals {
  const items = Object.values(state.pulledItems);
  const sum = (pick: (item: PulledContribution) => number): number =>
    items.reduce((total, item) => total + pick(item), 0);
  const amountNanoMinor = sum((item) => item.amountNanoMinor);
  const billerUsd = items.map((item) => item.amountNanoUsd ?? null);
  // Null, never 0: no items, or a non-dollar cell where an item lacks the biller's own dollar figure.
  let amountNanoUsd: number | null = null;
  if (items.length > 0 && state.currencyCode === GOVERNANCE_COST_CURRENCY_USD) {
    amountNanoUsd = amountNanoMinor;
  } else if (items.length > 0 && billerUsd.every((usd) => usd !== null)) {
    amountNanoUsd = billerUsd.reduce<number>((total, usd) => total + (usd ?? 0), 0);
  }
  return {
    amountNanoUsd,
    amountNanoMinor,
    tokensInput: sum((item) => item.tokensInput),
    tokensOutput: sum((item) => item.tokensOutput),
    tokensCacheRead: sum((item) => item.tokensCacheRead),
    tokensCacheWrite: sum((item) => item.tokensCacheWrite),
    requestCount: items.length,
  };
}

type RevisionMarkers = Pick<
  PulledContribution,
  "priorAmountNanoMinor" | "priorAmountNanoUsd" | "priorObservedAtMs" | "revisedAtMs"
>;

/** Only a pull that MOVES the figure rewrites what came before; a confirming re-pull carries markers forward. */
export function revisionMarkersAfterPull({
  previous,
  movedTheFigure,
  observedAtMs,
}: {
  previous: PulledContribution | undefined;
  movedTheFigure: boolean;
  observedAtMs: number;
}): RevisionMarkers {
  if (movedTheFigure && previous !== undefined) {
    return {
      priorAmountNanoMinor: previous.amountNanoMinor,
      priorAmountNanoUsd: previous.amountNanoUsd,
      priorObservedAtMs: previous.observedAtMs,
      revisedAtMs: observedAtMs,
    };
  }
  return {
    priorAmountNanoMinor: previous?.priorAmountNanoMinor,
    priorAmountNanoUsd: previous?.priorAmountNanoUsd,
    priorObservedAtMs: previous?.priorObservedAtMs,
    revisedAtMs: previous?.revisedAtMs,
  };
}

/** Derived from the items, never accumulated, so the markers are a function of the observations alone. */
export function withDerivedRevisionMarkers(
  state: GovernanceCostRollupState,
): GovernanceCostRollupState {
  let revisedAt: number | null = null;
  for (const item of Object.values(state.pulledItems)) {
    if (item.revisedAtMs === undefined) continue;
    if (revisedAt === null || item.revisedAtMs > revisedAt) revisedAt = item.revisedAtMs;
  }
  if (revisedAt === null) return { ...state, revisedAt: null, previousAmountNanoUsd: null };
  const rewound = Object.fromEntries(
    Object.entries(state.pulledItems).map(([key, item]) => [
      key,
      item.revisedAtMs === revisedAt
        ? {
            ...item,
            amountNanoMinor: item.priorAmountNanoMinor ?? item.amountNanoMinor,
            amountNanoUsd: item.priorAmountNanoUsd,
          }
        : item,
    ]),
  );
  const before = governanceCostRollupTotals({ ...state, pulledItems: rewound }).amountNanoUsd;
  return { ...state, revisedAt, previousAmountNanoUsd: before };
}
