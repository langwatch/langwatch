/**
 * Wires AggregateHeaderBar (#5100) into the EvaluationsV3 workbench:
 * picks the first pairwise evaluator, computes its verdict aggregate
 * from `results`, resolves variant target ids to display names, and
 * provides handler stubs for the Phase F handoffs.
 *
 * Hidden when no pairwise evaluator is configured or no row has a
 * verdict yet — so the bar only appears once results exist.
 */

import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { useTargetName } from "../hooks/useTargetName";
import {
  computePairwiseAggregate,
  computePairwiseTargetAggregate,
  type PairwiseAggregate,
} from "../utils/computeAggregates";
import type { TargetConfig } from "../types";
import {
  AggregateHeaderBar,
  type PairwiseFilter,
} from "./AggregateHeaderBar";

const downloadCsv = (filename: string, rows: string[][]) => {
  const escape = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
  const csv = rows.map((r) => r.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const totalVerdicts = (counts: PairwiseAggregate["counts"]) =>
  counts.a + counts.b + counts.tie;

type ResolvedAggregateBarProps = {
  aggregate: PairwiseAggregate;
  variantATarget: TargetConfig | undefined;
  variantBTarget: TargetConfig | undefined;
  filter: PairwiseFilter;
  setFilter: (f: PairwiseFilter) => void;
};

function ResolvedAggregateBar({
  aggregate,
  variantATarget,
  variantBTarget,
  filter,
  setFilter,
}: ResolvedAggregateBarProps) {
  // Always call the hooks with a stable target reference. When a variant
  // target is missing from the store we fall back to its raw id.
  const variantANameRaw = useTargetName(variantATarget ?? PLACEHOLDER_TARGET);
  const variantBNameRaw = useTargetName(variantBTarget ?? PLACEHOLDER_TARGET);

  const variantAName = variantATarget
    ? variantANameRaw || aggregate.variantA
    : aggregate.variantA;
  const variantBName = variantBTarget
    ? variantBNameRaw || aggregate.variantB
    : aggregate.variantB;

  const handleExport = useCallback(() => {
    const header = ["row_index", "winner", "reasoning", "cost_usd"];
    const body = aggregate.perRow
      .map((v, i) => {
        if (!v) return null;
        const winner =
          v.label === "A"
            ? variantAName
            : v.label === "B"
              ? variantBName
              : "tie";
        return [
          String(i + 1),
          winner,
          v.reasoning ?? "",
          v.costAmount.toFixed(6),
        ];
      })
      .filter((row): row is string[] => row !== null);
    downloadCsv(
      `pairwise-verdicts-${variantAName}-vs-${variantBName}.csv`,
      [header, ...body],
    );
  }, [aggregate, variantAName, variantBName]);

  return (
    <AggregateHeaderBar
      counts={aggregate.counts}
      variantAName={variantAName}
      variantBName={variantBName}
      totalCost={aggregate.totalCost}
      activeFilter={filter}
      onFilterChange={setFilter}
      onExport={handleExport}
    />
  );
}

const PLACEHOLDER_TARGET = {
  id: "__pairwise-placeholder__",
  type: "prompt",
  promptId: undefined,
} as unknown as TargetConfig;

export function PairwiseAggregateHeader() {
  const [filter, setFilter] = useState<PairwiseFilter>("all");

  const { evaluators, targets, results, rowCount } = useEvaluationsV3Store(
    useShallow((state) => ({
      evaluators: state.evaluators,
      targets: state.targets,
      results: state.results,
      rowCount: state.getRowCount(state.activeDatasetId),
    })),
  );

  // MVP: render the first pairwise comparison. Prefer the column-target
  // shape because that is the user-facing "Pairwise Compare" column.
  const pairwiseEvaluator = useMemo(
    () => evaluators.find((e) => e.pairwise),
    [evaluators],
  );
  const pairwiseTarget = useMemo(
    () => targets.find((t) => t.pairwise),
    [targets],
  );

  const aggregate = useMemo(() => {
    if (pairwiseTarget) {
      return computePairwiseTargetAggregate(pairwiseTarget, results, rowCount);
    }
    if (!pairwiseEvaluator) return null;
    return computePairwiseAggregate(pairwiseEvaluator, results, rowCount);
  }, [pairwiseTarget, pairwiseEvaluator, results, rowCount]);

  const variantATarget = useMemo(
    () => (aggregate ? targets.find((t) => t.id === aggregate.variantA) : undefined),
    [aggregate, targets],
  );
  const variantBTarget = useMemo(
    () => (aggregate ? targets.find((t) => t.id === aggregate.variantB) : undefined),
    [aggregate, targets],
  );

  if (!aggregate || totalVerdicts(aggregate.counts) === 0) return null;

  return (
    <ResolvedAggregateBar
      aggregate={aggregate}
      variantATarget={variantATarget}
      variantBTarget={variantBTarget}
      filter={filter}
      setFilter={setFilter}
    />
  );
}
