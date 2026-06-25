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
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { resolveTargetNameFromCache } from "../hooks/resolveTargetName";
import {
  computePairwiseAggregate,
  type PairwiseAggregate,
} from "../utils/computeAggregates";
import {
  AggregateHeaderBar,
  type AggregateFilter,
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

export function PairwiseAggregateHeader() {
  const { project } = useOrganizationTeamProject();
  const trpcUtils = api.useContext();
  const [filter, setFilter] = useState<AggregateFilter>("all");

  const { evaluators, targets, results, rowCount } = useEvaluationsV3Store(
    useShallow((state) => ({
      evaluators: state.evaluators,
      targets: state.targets,
      results: state.results,
      rowCount: state.getRowCount(state.activeDatasetId),
    })),
  );

  // MVP: only render the bar for the first pairwise evaluator. Stacked
  // pairwise evaluators (rare in practice) can be addressed later.
  const pairwiseEvaluator = useMemo(
    () => evaluators.find((e) => e.pairwise),
    [evaluators],
  );

  const aggregate = useMemo(() => {
    if (!pairwiseEvaluator) return null;
    return computePairwiseAggregate(pairwiseEvaluator, results, rowCount);
  }, [pairwiseEvaluator, results, rowCount]);

  const variantANameFromCache = useMemo(() => {
    if (!aggregate) return undefined;
    const t = targets.find((tg) => tg.id === aggregate.variantA);
    if (!t) return undefined;
    return resolveTargetNameFromCache({
      target: t,
      utils: trpcUtils,
      projectId: project?.id,
    });
  }, [aggregate, targets, trpcUtils, project?.id]);

  const variantBNameFromCache = useMemo(() => {
    if (!aggregate) return undefined;
    const t = targets.find((tg) => tg.id === aggregate.variantB);
    if (!t) return undefined;
    return resolveTargetNameFromCache({
      target: t,
      utils: trpcUtils,
      projectId: project?.id,
    });
  }, [aggregate, targets, trpcUtils, project?.id]);

  const handleExport = useCallback(() => {
    if (!aggregate) return;
    const aName = variantANameFromCache ?? aggregate.variantA;
    const bName = variantBNameFromCache ?? aggregate.variantB;
    const header = ["row_index", "winner", "reasoning", "cost_usd"];
    const body = aggregate.perRow
      .map((v, i) => {
        if (!v) return null;
        const winner =
          v.label === "A" ? aName : v.label === "B" ? bName : "tie";
        return [
          String(i + 1),
          winner,
          v.reasoning ?? "",
          v.costAmount.toFixed(6),
        ];
      })
      .filter((row): row is string[] => row !== null);
    downloadCsv(
      `pairwise-verdicts-${aName}-vs-${bName}.csv`,
      [header, ...body],
    );
  }, [aggregate, variantANameFromCache, variantBNameFromCache]);

  const handlePromote = useCallback(
    (variantId: string) => {
      const name =
        variantId === aggregate?.variantA
          ? (variantANameFromCache ?? aggregate.variantA)
          : variantId === aggregate?.variantB
            ? (variantBNameFromCache ?? aggregate.variantB)
            : variantId;
      toaster.create({
        title: `Promote ${name} — coming soon`,
        description:
          "Promotion will register this variant as the production prompt in a follow-up PR.",
        type: "info",
        duration: 4000,
        meta: { closable: true },
      });
    },
    [aggregate, variantANameFromCache, variantBNameFromCache],
  );

  if (!aggregate || totalVerdicts(aggregate.counts) === 0) return null;

  const variantAName = variantANameFromCache ?? aggregate.variantA;
  const variantBName = variantBNameFromCache ?? aggregate.variantB;

  return (
    <AggregateHeaderBar
      variants={[
        { id: aggregate.variantA, name: variantAName, wins: aggregate.counts.a },
        { id: aggregate.variantB, name: variantBName, wins: aggregate.counts.b },
      ]}
      ties={aggregate.counts.tie}
      totalCost={aggregate.totalCost}
      activeFilter={filter}
      onFilterChange={setFilter}
      onExport={handleExport}
      onPromote={handlePromote}
      biasCorrected={true}
    />
  );
}
