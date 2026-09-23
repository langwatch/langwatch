// A child walk that only ever looks at keys that can hold a node. The
// reflective walk it replaces iterated `loc`, `range`, `start` and `end` on
// every node of every file; those are not AST and never will be.

const NON_NODE_KEYS = new Set([
  "comments",
  "end",
  "innerComments",
  "leadingComments",
  "loc",
  "parent",
  "range",
  "raw",
  "start",
  "tokens",
  "trailingComments",
  "type",
]);

function* nodesIn(value) {
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    if (item && typeof item.type === "string") yield item;
  }
}

/** The direct child nodes of `node`, in key order. */
export function* childNodes(node) {
  if (!node) return;

  for (const key of Object.keys(node)) {
    if (!NON_NODE_KEYS.has(key)) yield* nodesIn(node[key]);
  }
}

/**
 * Depth-first walk. A visitor returning `false` skips its own subtree.
 * @param {object | null | undefined} node
 * @param {(node: object) => boolean | void} visitor
 */
export function walk(node, visitor) {
  if (!node) return;
  if (visitor(node) === false) return;

  for (const child of childNodes(node)) walk(child, visitor);
}
