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

function isNode(value) {
  return value !== null && typeof value === "object" && typeof value.type === "string";
}

/** The direct child nodes of `node`, in key order. */
export function childNodes(node) {
  const children = [];
  if (!node) return children;

  for (const key of Object.keys(node)) {
    if (NON_NODE_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) children.push(...value.filter(isNode));
    else if (isNode(value)) children.push(value);
  }

  return children;
}

/**
 * Depth-first walk, with no generator or array per node. A visitor returning `false` skips its
 * own subtree.
 * @param {object | null | undefined} node
 * @param {(node: object) => boolean | void} visitor
 */
export function walk(node, visitor) {
  if (!node) return;
  if (visitor(node) === false) return;

  for (const key of Object.keys(node)) {
    if (!NON_NODE_KEYS.has(key)) walkValue(node[key], visitor);
  }
}

/** Walks the node, or each node of the array, one key of a parent holds. */
function walkValue(value, visitor) {
  if (!Array.isArray(value)) {
    if (isNode(value)) walk(value, visitor);
    return;
  }
  for (const item of value) {
    if (isNode(item)) walk(item, visitor);
  }
}
