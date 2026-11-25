/** The slice of mdast/hast/MDX-JSX node shape the docs compilers read and rewrite. */
export type TreeAttribute = { type?: string; name: string; value?: unknown };
export type TreeNode = {
  type: string;
  name?: string | null;
  tagName?: string;
  value?: string;
  url?: string;
  children?: TreeNode[];
  attributes?: TreeAttribute[];
  properties?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

export function visitTree({
  node,
  visitor,
}: {
  node: TreeNode;
  visitor: (node: TreeNode) => void;
}) {
  visitor(node);
  for (const child of node.children ?? []) visitTree({ node: child, visitor });
}

/** A hast element's `id`, when it has a non-empty one. */
export function idOf({ node }: { node: TreeNode }) {
  const id = node.properties?.id;
  return typeof id === "string" && id ? id : undefined;
}

/** Concatenated `text` nodes; expressions, comments and other literals are skipped. */
export function textOf({ node }: { node: TreeNode }): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map((child) => textOf({ node: child })).join("");
}
