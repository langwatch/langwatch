import type { ModelCostEstimateInput } from "@langwatch/model-provider-contract";
import type { BraidedOwner, TraceBraidedSummary, TraceHeader } from "@langwatch/trace-contract";

/** One project's spans in one trace and price, as the braided fence let them through. */
export interface BraidedSpanGroup {
  tenantId: string;
  spanCount: number;
  startMs: number;
  endMs: number;
  inputTokens: number;
  outputTokens: number;
  explicitCost: number;
  costInput: ModelCostEstimateInput | null;
}

/** One owner's braided spans in a trace, as the header adds them in. */
export interface BraidedOwnerTotals {
  ownerProjectId: string;
  spanCount: number;
  startMs: number;
  endMs: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

/** Each owner's totals in header order, earliest span first; the reader's own are left out. */
export function braidedOwnerTotalsOf({
  groups,
  readerProjectId,
  priceOf,
}: {
  groups: readonly BraidedSpanGroup[];
  readerProjectId: string;
  priceOf: (costInput: ModelCostEstimateInput) => number;
}): BraidedOwnerTotals[] {
  const byOwner = new Map<string, BraidedOwnerTotals>();
  for (const group of groups) {
    if (group.tenantId === readerProjectId) continue;
    const priced = group.costInput === null ? 0 : Math.max(0, priceOf(group.costInput));
    const seen = byOwner.get(group.tenantId);
    byOwner.set(group.tenantId, {
      ownerProjectId: group.tenantId,
      spanCount: (seen?.spanCount ?? 0) + group.spanCount,
      startMs: Math.min(seen?.startMs ?? group.startMs, group.startMs),
      endMs: Math.max(seen?.endMs ?? group.endMs, group.endMs),
      cost: (seen?.cost ?? 0) + group.explicitCost + priced,
      inputTokens: (seen?.inputTokens ?? 0) + group.inputTokens,
      outputTokens: (seen?.outputTokens ?? 0) + group.outputTokens,
    });
  }
  return [...byOwner.values()].toSorted(
    (a, b) => a.startMs - b.startMs || a.ownerProjectId.localeCompare(b.ownerProjectId),
  );
}

type OwnTotals = Pick<
  TraceHeader,
  "timestamp" | "durationMs" | "spanCount" | "totalCost" | "inputTokens" | "outputTokens"
>;

/** The header's whole-trace totals: its own plus the braided spans the reader sees (ADR-183 §5). */
export function braidedTraceSummaryOf({
  header,
  owners,
  totals,
  canSeeCosts,
}: {
  header: OwnTotals;
  owners: readonly BraidedOwner[];
  totals: readonly BraidedOwnerTotals[];
  canSeeCosts: boolean;
}): TraceBraidedSummary {
  const sum = (pick: (owner: BraidedOwnerTotals) => number) =>
    totals.reduce((acc, owner) => acc + pick(owner), 0);
  const plus = (own: number | null, braided: number) =>
    own === null && braided === 0 ? null : (own ?? 0) + braided;
  const startMs = Math.min(header.timestamp, ...totals.map((owner) => owner.startMs));
  const endMs = Math.max(
    header.timestamp + header.durationMs,
    ...totals.map((owner) => owner.endMs),
  );
  return {
    owners: [...owners],
    spanCount: header.spanCount + sum((owner) => owner.spanCount),
    durationMs: Math.max(0, endMs - startMs),
    cost: canSeeCosts
      ? plus(
          header.totalCost,
          sum((owner) => owner.cost),
        )
      : null,
    inputTokens: plus(
      header.inputTokens,
      sum((owner) => owner.inputTokens),
    ),
    outputTokens: plus(
      header.outputTokens,
      sum((owner) => owner.outputTokens),
    ),
  };
}
