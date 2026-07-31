/**
 * Which variants a Bradley-Terry fit is actually entitled to compare.
 *
 * The maximum-likelihood estimate exists and is unique only when the win
 * digraph is STRONGLY CONNECTED — for every split of the field into two
 * non-empty groups, somebody in each group must have beaten somebody in the
 * other (Ford 1957; Hunter 2004 §4). The solver's own guard tests something
 * weaker: that no single variant has zero wins or zero losses. That is
 * necessary but not sufficient, and the gap is not exotic — it is the most
 * ordinary shape in evaluator data:
 *
 *   - TIERED. Two good variants trade wins, two bad ones trade wins, and the
 *     good ones never lose to the bad ones. Every variant has wins and losses,
 *     so the old guard says "healthy". But the likelihood has no maximum: it
 *     climbs forever as the good tier's strength runs to infinity. The solver
 *     stops at `maxIter` and reports whatever it had reached — 702 at 500
 *     iterations, 1302 at a million. The number is a readout of the iteration
 *     cap, not a measurement, and it is reported with a confidence interval
 *     that tightens around it as more data arrives.
 *
 *   - DISCONNECTED. Two groups that never meet at all. Here the likelihood is
 *     exactly FLAT along the between-group scale, so the solver returns
 *     whatever its all-ones initialisation happened to preserve. Feeding one
 *     group more lopsided results silently reorders it against the other, on
 *     evidence that says nothing whatever about that comparison. Reachable in
 *     the ordinary way: the Comparison evaluator drops a candidate that
 *     produced no output for a row, so two variants erroring on the rows the
 *     other two answered is exactly this.
 *
 * So the fit is decomposed into strongly connected components. Within a
 * component, scores are comparable and the interval arithmetic means what it
 * says. Across components only the DIRECTION survives, and only where one
 * component actually beat the other: the magnitude is unbounded, and where
 * two components never met, not even the direction is known.
 */

import type { WinMatrix } from "./computeBTLeaderboard";

export type Comparability = {
  /**
   * True when every variant sits in one strongly connected component — the
   * MLE exists, is unique, and every score is comparable to every other.
   */
  identifiable: boolean;
  /**
   * Strongly connected components, strongest first. Variants inside a group
   * are mutually comparable; variants in different groups are not, beyond
   * the direction recorded in `dominates`.
   */
  groups: string[][];
  /**
   * `dominates[a][b]` is true when group a is provably above group b — some
   * member of a beat some member of b, and b never beat back, directly or
   * through a chain. Keyed by group index.
   */
  dominates: boolean[][];
};

/** Index of the group holding each variant. */
export const groupIndexOf = (
  comparability: Comparability,
): Record<string, number> => {
  const index: Record<string, number> = {};
  comparability.groups.forEach((group, i) => {
    for (const id of group) index[id] = i;
  });
  return index;
};

/**
 * Whether the run is entitled to compare these two variants at all.
 *
 * Same group — yes, the usual interval test applies. Different groups where
 * one dominates — the direction is certain but the score gap is fictional,
 * so a caller must not quote it. Different groups with no path — nothing is
 * known, and treating the scores as ordered would be inventing a result.
 */
export const comparabilityOf = ({
  comparability,
  a,
  b,
}: {
  comparability: Comparability;
  a: string;
  b: string;
}): "same-group" | "dominated" | "incomparable" => {
  const index = groupIndexOf(comparability);
  const ga = index[a];
  const gb = index[b];
  if (ga === undefined || gb === undefined) return "incomparable";
  if (ga === gb) return "same-group";
  return comparability.dominates[ga]?.[gb] || comparability.dominates[gb]?.[ga]
    ? "dominated"
    : "incomparable";
};

/**
 * Tarjan's strongly connected components over the win digraph.
 *
 * An edge a -> b exists when a beat b at least once. Ties count: a 0.5/0.5
 * row puts weight in both directions, which is exactly right — a tie is
 * evidence that connects the two variants, and it is what makes an otherwise
 * split field identifiable.
 *
 * Iterative rather than recursive: a pathological field is still only a few
 * hundred variants, but a stack overflow inside a results page is a bad way
 * to find that out.
 */
export const computeComparability = ({
  winMatrix,
  variantIds,
}: {
  winMatrix: WinMatrix;
  variantIds: string[];
}): Comparability => {
  const n = variantIds.length;
  if (n === 0) {
    return { identifiable: true, groups: [], dominates: [] };
  }

  const idx = new Map(variantIds.map((id, i) => [id, i]));
  const adjacency: number[][] = variantIds.map((rowId) => {
    const row = winMatrix[rowId] ?? {};
    const out: number[] = [];
    for (const [colId, wins] of Object.entries(row)) {
      const j = idx.get(colId);
      if (j !== undefined && wins > 0) out.push(j);
    }
    return out;
  });

  const index = new Array<number>(n).fill(-1);
  const lowlink = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const stack: number[] = [];
  const components: number[][] = [];
  let counter = 0;

  for (const root of variantIds.keys()) {
    if (index[root] !== -1) continue;

    // (node, next-neighbour-to-visit) — the explicit call stack.
    const work: Array<[number, number]> = [[root, 0]];
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const [v, pi] = frame;

      if (pi === 0) {
        index[v] = counter;
        lowlink[v] = counter;
        counter += 1;
        stack.push(v);
        onStack[v] = true;
      }

      const neighbours = adjacency[v]!;
      if (pi < neighbours.length) {
        frame[1] = pi + 1;
        const w = neighbours[pi]!;
        if (index[w] === -1) {
          work.push([w, 0]);
        } else if (onStack[w]) {
          lowlink[v] = Math.min(lowlink[v]!, index[w]!);
        }
        continue;
      }

      // v is finished.
      if (lowlink[v] === index[v]) {
        const component: number[] = [];
        for (;;) {
          const w = stack.pop()!;
          onStack[w] = false;
          component.push(w);
          if (w === v) break;
        }
        components.push(component);
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        lowlink[parent[0]] = Math.min(lowlink[parent[0]]!, lowlink[v]!);
      }
    }
  }

  // Tarjan emits components in reverse topological order, so a component is
  // produced only after everything it points to. Reversing puts the dominant
  // group — the one that beat others without losing back — first.
  components.reverse();

  const groupOf = new Array<number>(n).fill(-1);
  components.forEach((component, g) => {
    for (const v of component) groupOf[v] = g;
  });

  const g = components.length;
  const reaches: boolean[][] = Array.from({ length: g }, () =>
    new Array<boolean>(g).fill(false),
  );
  for (let v = 0; v < n; v++) {
    for (const w of adjacency[v]!) {
      const gv = groupOf[v]!;
      const gw = groupOf[w]!;
      if (gv !== gw) reaches[gv]![gw] = true;
    }
  }
  // Transitive closure — dominance is inherited through chains.
  for (let k = 0; k < g; k++) {
    for (let i = 0; i < g; i++) {
      if (!reaches[i]![k]) continue;
      for (let j = 0; j < g; j++) {
        if (reaches[k]![j]) reaches[i]![j] = true;
      }
    }
  }

  return {
    identifiable: components.length <= 1,
    groups: components.map((component) => component.map((v) => variantIds[v]!)),
    dominates: reaches,
  };
};
