/**
 * Bradley-Terry scores are comparable only inside a strongly connected win
 * graph (Ford 1957; Hunter 2004 §4). Per-variant wins and losses are not
 * enough: tiered or disconnected fields make between-group magnitudes
 * unidentifiable. We therefore expose components and only retain a direction
 * where one component actually beat another.
 */

import type { WinMatrix } from "./batch-evaluation-results.bt-leaderboard";

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
export const groupIndexOf = (comparability: Comparability): Record<string, number> => {
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
  if (ga === void 0 || gb === void 0) return "incomparable";
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
      if (j !== void 0 && wins > 0) out.push(j);
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
  if (w === void 0) return false;
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
  if (parent) t.lowlink[parent[0]] = Math.min(t.lowlink[parent[0]]!, t.lowlink[v]!);
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
    index: Array.from({ length: n }, () => -1),
    lowlink: Array.from({ length: n }, () => 0),
    onStack: Array.from({ length: n }, () => false),
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
  const groupOf = Array.from({ length: adjacency.length }, () => -1);
  components.forEach((component, g) => {
    for (const v of component) groupOf[v] = g;
  });

  const reaches: boolean[][] = Array.from({ length: components.length }, () =>
    Array.from({ length: components.length }, () => false),
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
