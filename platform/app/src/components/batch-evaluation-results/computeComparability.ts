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
 * Whether the fit POSITIVELY establishes that these two never met.
 *
 * The distinction from `comparabilityOf` is the absent-evidence case. That
 * function answers "incomparable" both for a pair it knows never met and for
 * a variant it has never heard of — right for its own question, wrong as a
 * veto, since a leaderboard whose graph was never decomposed (no groups at
 * all) would then have every pair vetoed. Callers that suppress a claim on
 * the strength of a break need the narrower question, and they need to ask it
 * the same way, so it is asked once here.
 */
export const isIncomparable = ({
  comparability,
  a,
  b,
}: {
  comparability?: Comparability | null;
  a: string;
  b: string;
}): boolean =>
  !!comparability &&
  comparability.groups.length > 0 &&
  comparabilityOf({ comparability, a, b }) === "incomparable";

/**
 * The win digraph as adjacency lists over variant indices.
 *
 * An edge a -> b exists when a beat b at least once. Ties count: a 0.5/0.5
 * row puts weight in both directions, which is exactly right — a tie is
 * evidence that connects the two variants, and it is what makes an otherwise
 * split field identifiable.
 */
const buildAdjacency = ({
  winMatrix,
  variantIds,
}: {
  winMatrix: WinMatrix;
  variantIds: string[];
}): number[][] => {
  const idx = new Map(variantIds.map((id, i) => [id, i]));
  return variantIds.map((rowId) => {
    const out: number[] = [];
    for (const [colId, wins] of Object.entries(winMatrix[rowId] ?? {})) {
      const j = idx.get(colId);
      if (j !== undefined && wins > 0) out.push(j);
    }
    return out;
  });
};

/**
 * Tarjan's bookkeeping. It is one algorithm split across the four functions
 * below only so each stays readable; they are not independently useful.
 *
 * `work` is the explicit call stack — (node, next-neighbour-to-visit) — which
 * is what makes the traversal iterative. A pathological field is still only a
 * few hundred variants, but a stack overflow inside a results page is a bad
 * way to find that out.
 */
type Tarjan = {
  adjacency: number[][];
  index: number[];
  lowlink: number[];
  onStack: boolean[];
  stack: number[];
  components: number[][];
  work: Array<[node: number, nextNeighbour: number]>;
  counter: number;
};

/** First arrival at `v`: number it and put it on the component stack. */
const discover = (t: Tarjan, v: number): void => {
  t.index[v] = t.counter;
  t.lowlink[v] = t.counter;
  t.counter += 1;
  t.stack.push(v);
  t.onStack[v] = true;
};

/**
 * Take one edge out of the top frame. False when the node has no edge left,
 * which is the signal to finish it.
 */
const advance = (t: Tarjan, frame: Tarjan["work"][number]): boolean => {
  const [v, pi] = frame;
  const w = t.adjacency[v]![pi];
  if (w === undefined) return false;
  frame[1] = pi + 1;
  if (t.index[w] === -1) t.work.push([w, 0]);
  else if (t.onStack[w]) t.lowlink[v] = Math.min(t.lowlink[v]!, t.index[w]!);
  return true;
};

/**
 * `v` has no edges left. A node whose lowlink never escaped its own index is
 * the root of a component, so unwind the stack down to it; either way the
 * lowlink flows back to the caller.
 */
const retreat = (t: Tarjan, v: number): void => {
  if (t.lowlink[v] === t.index[v]) {
    const component: number[] = [];
    for (;;) {
      const w = t.stack.pop()!;
      t.onStack[w] = false;
      component.push(w);
      if (w === v) break;
    }
    t.components.push(component);
  }
  t.work.pop();
  const parent = t.work[t.work.length - 1];
  if (parent)
    t.lowlink[parent[0]] = Math.min(t.lowlink[parent[0]]!, t.lowlink[v]!);
};

/** Walk everything reachable from `root` that has not been numbered yet. */
const traverseFrom = (t: Tarjan, root: number): void => {
  t.work.push([root, 0]);
  while (t.work.length > 0) {
    const frame = t.work[t.work.length - 1]!;
    if (frame[1] === 0) discover(t, frame[0]);
    if (!advance(t, frame)) retreat(t, frame[0]);
  }
};

/** Strongly connected components of the win digraph, strongest first. */
const stronglyConnectedComponents = (adjacency: number[][]): number[][] => {
  const n = adjacency.length;
  const t: Tarjan = {
    adjacency,
    index: new Array<number>(n).fill(-1),
    lowlink: new Array<number>(n).fill(0),
    onStack: new Array<boolean>(n).fill(false),
    stack: [],
    components: [],
    work: [],
    counter: 0,
  };

  for (let root = 0; root < n; root++) {
    if (t.index[root] === -1) traverseFrom(t, root);
  }

  // Tarjan emits components in reverse topological order, so a component is
  // produced only after everything it points to. Reversing puts the dominant
  // group — the one that beat others without losing back — first.
  t.components.reverse();
  return t.components;
};

/** Everything group `k` reaches is reachable from everything that reaches k. */
const propagateThrough = (reaches: boolean[][], k: number): void => {
  for (const row of reaches) {
    if (!row[k]) continue;
    for (let j = 0; j < reaches.length; j++) {
      if (reaches[k]![j]) row[j] = true;
    }
  }
};

/** `dominates[a][b]`: group a reaches group b, directly or through a chain. */
const dominanceClosure = ({
  adjacency,
  components,
}: {
  adjacency: number[][];
  components: number[][];
}): boolean[][] => {
  const groupOf = new Array<number>(adjacency.length).fill(-1);
  components.forEach((component, g) => {
    for (const v of component) groupOf[v] = g;
  });

  const reaches: boolean[][] = Array.from({ length: components.length }, () =>
    new Array<boolean>(components.length).fill(false),
  );
  adjacency.forEach((neighbours, v) => {
    for (const w of neighbours) {
      if (groupOf[v] !== groupOf[w]) reaches[groupOf[v]!]![groupOf[w]!] = true;
    }
  });
  // Transitive closure — dominance is inherited through chains.
  for (let k = 0; k < components.length; k++) propagateThrough(reaches, k);
  return reaches;
};

/**
 * Decompose the win digraph into the groups a Bradley-Terry fit may compare.
 */
export const computeComparability = ({
  winMatrix,
  variantIds,
}: {
  winMatrix: WinMatrix;
  variantIds: string[];
}): Comparability => {
  if (variantIds.length === 0) {
    return { identifiable: true, groups: [], dominates: [] };
  }

  const adjacency = buildAdjacency({ winMatrix, variantIds });
  const components = stronglyConnectedComponents(adjacency);

  return {
    identifiable: components.length <= 1,
    groups: components.map((component) => component.map((v) => variantIds[v]!)),
    dominates: dominanceClosure({ adjacency, components }),
  };
};
