/**
 * Pure structural measurement and traversal of a candidate Vega-Lite spec.
 *
 * Everything here treats the spec as untrusted JSON: nothing is assumed about
 * its shape, the traversals are iterative so a pathologically nested document
 * cannot exhaust the stack, and no value is read for meaning — only for size,
 * depth, and composition.
 */

/** JSON Pointer for the document root. Never `""`, so a path is always shown. */
export const JSON_POINTER_ROOT = "/";

const TEXT_ENCODER = new TextEncoder();

/** Keys whose values are arrays of child specs in the Vega-Lite composition tree. */
const COMPOSITION_ARRAY_KEYS = [
  "layer",
  "hconcat",
  "vconcat",
  "concat",
] as const;

/** Keys whose presence makes `spec` a single child view template. */
const COMPOSITION_WRAPPER_KEYS = ["facet", "repeat"] as const;

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Appends one segment to a JSON Pointer, escaping per RFC 6901. */
export function joinPointer(parent: string, segment: string | number): string {
  const escaped = String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
  return parent === JSON_POINTER_ROOT
    ? `${JSON_POINTER_ROOT}${escaped}`
    : `${parent}/${escaped}`;
}

/** Size of a string in UTF-8 bytes, which is what every byte ceiling counts. */
export function measureUtf8Bytes(text: string): number {
  return TEXT_ENCODER.encode(text).length;
}

/**
 * Serialized size in UTF-8 bytes. Returns `null` when the value cannot be
 * serialized at all (cycles, or nesting deep enough to defeat `JSON.stringify`),
 * which callers treat as a refusal rather than as "small enough".
 */
export function measureSpecBytes(spec: unknown): number | null {
  try {
    const json = JSON.stringify(spec);
    if (typeof json !== "string") return null;
    return measureUtf8Bytes(json);
  } catch {
    return null;
  }
}

/**
 * Depth of the object/array tree, where a scalar is 0 and any container is
 * `1 + max(child)`. Stops climbing at `ceiling + 1` so an adversarially deep
 * document costs no more than a shallow one to refuse.
 */
export function measureJsonDepth(root: unknown, ceiling: number): number {
  const stack: { value: unknown; depth: number }[] = [
    { value: root, depth: 1 },
  ];
  let deepest = 0;

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    const children = childValuesOf(entry.value);
    if (children === null) continue;

    deepest = Math.max(deepest, entry.depth);
    if (deepest > ceiling) return deepest;
    for (const child of children) {
      stack.push({ value: child, depth: entry.depth + 1 });
    }
  }

  return deepest;
}

/** Container children, or `null` when the value is a scalar. */
function childValuesOf(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (isPlainObject(value)) return Object.values(value);
  return null;
}

/** One object node of the spec document, with the pointer that reaches it. */
export interface JsonObjectNode {
  readonly path: string;
  readonly node: Record<string, unknown>;
  /** The key on the parent object that holds this node, or `null` at the root. */
  readonly parentKey: string | null;
}

/**
 * Every object node in the document, root first. Arrays are traversed but not
 * reported — a rule that cares about position reads the pointer.
 */
export function visitJsonObjects(root: unknown): JsonObjectNode[] {
  const found: JsonObjectNode[] = [];
  const stack: JsonObjectNode[] = [];
  if (isPlainObject(root)) {
    stack.push({ path: JSON_POINTER_ROOT, node: root, parentKey: null });
  }

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    found.push(entry);
    for (const [key, value] of Object.entries(entry.node)) {
      pushDescendants({
        stack,
        path: joinPointer(entry.path, key),
        key,
        value,
      });
    }
  }

  return found;
}

function pushDescendants({
  stack,
  path,
  key,
  value,
}: {
  stack: JsonObjectNode[];
  path: string;
  key: string;
  value: unknown;
}): void {
  if (isPlainObject(value)) {
    stack.push({ path, node: value, parentKey: key });
    return;
  }
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => {
    if (isPlainObject(item)) {
      stack.push({
        path: joinPointer(path, index),
        node: item,
        parentKey: key,
      });
    }
  });
}

/** Keys whose values are nested predicates. */
const PREDICATE_BRANCH_KEYS = ["and", "or", "not"] as const;

/**
 * Walks a predicate and everything its `and`/`or`/`not` branches contain,
 * calling `visit` on each node with the pointer that reaches it — the node
 * itself first, then its branches in that order.
 *
 * Every predicate slot in Vega-Lite is either a value or one of those three
 * compositions, so this is the whole descent; sharing it keeps the expression
 * screen and the field check reading the same tree.
 */
export function visitPredicate({
  predicate,
  path = JSON_POINTER_ROOT,
  visit,
}: {
  predicate: unknown;
  /** Pointer to `predicate` itself. Only a caller that reports positions needs it. */
  path?: string;
  visit: (found: { readonly value: unknown; readonly path: string }) => void;
}): void {
  visit({ value: predicate, path });
  if (!isPlainObject(predicate)) return;

  for (const key of PREDICATE_BRANCH_KEYS) {
    const branch = predicate[key];
    if (branch === undefined) continue;

    const branchPath = joinPointer(path, key);
    if (Array.isArray(branch)) {
      branch.forEach((item, index) =>
        visitPredicate({
          predicate: item,
          path: joinPointer(branchPath, index),
          visit,
        }),
      );
      continue;
    }
    visitPredicate({ predicate: branch, path: branchPath, visit });
  }
}

/** A node of the Vega-Lite composition tree, with its inherited context. */
export interface VegaViewNode {
  readonly path: string;
  /** Pointer to the node that contains this one; `null` at the root. */
  readonly parentPath: string | null;
  readonly node: Record<string, unknown>;
  /** True when the node draws marks itself, rather than composing children. */
  readonly isUnit: boolean;
  /** The dataset feeding this node, resolved by inheritance; `null` when none does. */
  readonly datasetName: string | null;
  /** The dataset this node names itself; `null` when it names none of its own. */
  readonly declaredDatasetName: string | null;
  /** Pointer to the `data` object that resolved the name, for error reporting. */
  readonly dataPath: string | null;
  /** Field lists bound to `repeat` variables in scope at this node. */
  readonly repeatFields: Readonly<Record<string, readonly string[]>>;
}

/**
 * Flattens the composition tree, carrying data and `repeat` scope down to each
 * node. Data inheritance is Vega-Lite's own: a node without `data` reads the
 * nearest ancestor that has one.
 *
 * Safe to recurse because the pipeline refuses anything past the nesting
 * ceiling before this runs.
 */
export function collectViewNodes(spec: unknown): VegaViewNode[] {
  const collected: VegaViewNode[] = [];
  collectFrom({
    node: spec,
    path: JSON_POINTER_ROOT,
    parentPath: null,
    inherited: { datasetName: null, dataPath: null, repeatFields: {} },
    collected,
  });
  return collected;
}

interface InheritedViewContext {
  readonly datasetName: string | null;
  readonly dataPath: string | null;
  readonly repeatFields: Readonly<Record<string, readonly string[]>>;
}

function collectFrom({
  node,
  path,
  parentPath,
  inherited,
  collected,
}: {
  node: unknown;
  path: string;
  parentPath: string | null;
  inherited: InheritedViewContext;
  collected: VegaViewNode[];
}): void {
  if (!isPlainObject(node)) return;

  const context = extendContext({ node, path, inherited });
  collected.push({
    path,
    parentPath,
    node,
    isUnit: "mark" in node,
    datasetName: context.datasetName,
    declaredDatasetName: declaredDatasetNameOf(node),
    dataPath: context.dataPath,
    repeatFields: context.repeatFields,
  });

  for (const child of compositionChildrenOf({ node, path })) {
    collectFrom({ ...child, parentPath: path, inherited: context, collected });
  }
}

/** The dataset a node names itself, or `null` when its `data` names none. */
function declaredDatasetNameOf(node: Record<string, unknown>): string | null {
  const data = node.data;
  return isPlainObject(data) && typeof data.name === "string"
    ? data.name
    : null;
}

function extendContext({
  node,
  path,
  inherited,
}: {
  node: Record<string, unknown>;
  path: string;
  inherited: InheritedViewContext;
}): InheritedViewContext {
  const declaresData = isPlainObject(node.data);

  return {
    datasetName: declaresData
      ? declaredDatasetNameOf(node)
      : inherited.datasetName,
    dataPath: declaresData ? joinPointer(path, "data") : inherited.dataPath,
    repeatFields: {
      ...inherited.repeatFields,
      ...repeatFieldsOf(node.repeat),
    },
  };
}

/** Binds `repeat` variable names to their field lists. */
export function repeatFieldsOf(
  repeat: unknown,
): Readonly<Record<string, readonly string[]>> {
  if (Array.isArray(repeat)) {
    return { repeat: repeat.filter((v): v is string => typeof v === "string") };
  }
  if (!isPlainObject(repeat)) return {};

  const bound: Record<string, readonly string[]> = {};
  for (const variable of ["row", "column", "layer"]) {
    const list = repeat[variable];
    if (Array.isArray(list)) {
      bound[variable] = list.filter((v): v is string => typeof v === "string");
    }
  }
  return bound;
}

/**
 * The child specs a composition node contains: `layer`/`hconcat`/`vconcat`/
 * `concat` entries, and the single `spec` a `facet` or `repeat` wraps. Shared so
 * that policy and field validation agree on what the composition tree is.
 */
export function compositionChildrenOf({
  node,
  path,
}: {
  node: Record<string, unknown>;
  path: string;
}): { node: unknown; path: string }[] {
  const children: { node: unknown; path: string }[] = [];

  for (const key of COMPOSITION_ARRAY_KEYS) {
    const list = node[key];
    if (!Array.isArray(list)) continue;
    list.forEach((child, index) => {
      children.push({
        node: child,
        path: joinPointer(joinPointer(path, key), index),
      });
    });
  }

  const wraps = COMPOSITION_WRAPPER_KEYS.some((key) => key in node);
  if (wraps && "spec" in node) {
    children.push({ node: node.spec, path: joinPointer(path, "spec") });
  }

  return children;
}

/**
 * Unit views a spec renders, with `repeat` expanded by its list length. `facet`
 * multiplies by a data-driven count that cannot be known statically, so it
 * charges 1 for the definition itself and leans on the row ceiling for the rest.
 */
export function countUnitViews(spec: unknown): number {
  if (!isPlainObject(spec)) return 0;
  if ("mark" in spec) return 1;

  let total = 0;
  for (const key of COMPOSITION_ARRAY_KEYS) {
    const list = spec[key];
    if (Array.isArray(list)) {
      total += list.reduce<number>(
        (sum, child) => sum + countUnitViews(child),
        0,
      );
    }
  }

  if ("repeat" in spec)
    return total + repeatMultiplier(spec.repeat) * countUnitViews(spec.spec);
  if ("facet" in spec) return total + 1 + countUnitViews(spec.spec);
  return total;
}

/** How many times a `repeat` definition expands its child spec. */
export function repeatMultiplier(repeat: unknown): number {
  if (Array.isArray(repeat)) return repeat.length;
  if (!isPlainObject(repeat)) return 1;

  return ["row", "column", "layer"].reduce((product, variable) => {
    const list = repeat[variable];
    return Array.isArray(list) && list.length > 0
      ? product * list.length
      : product;
  }, 1);
}
