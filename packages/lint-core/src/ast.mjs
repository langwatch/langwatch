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

/** The direct child nodes of `node`, in key order. */
export function* childNodes(node) {
  if (!node) return;

  for (const key of Object.keys(node)) {
    if (NON_NODE_KEYS.has(key)) continue;

    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item.type === "string") yield item;
      }
      continue;
    }

    if (value && typeof value.type === "string") yield value;
  }
}

/**
 * Depth-first walk of `node` and its descendants. A visitor that returns
 * `false` keeps its subtree unvisited, which is how a rule stops at a nested
 * function without walking into it.
 *
 * @param {object | null | undefined} node
 * @param {(node: object) => boolean | void} visitor
 */
export function walk(node, visitor) {
  if (!node) return;
  if (visitor(node) === false) return;

  for (const child of childNodes(node)) walk(child, visitor);
}
