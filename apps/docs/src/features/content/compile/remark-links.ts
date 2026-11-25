import path from "node:path";

import { visitTree, type TreeNode } from "../../../lib/syntax-tree.ts";

function absoluteHref({ href, slug }: { href: string; slug: string }) {
  if (!/^\.{1,2}\//.test(href)) return href;
  const target = new URL(href, `https://docs.local/${slug}`);
  return `${target.pathname}${target.search}${target.hash}`;
}

/** Rewrites relative Markdown links and JSX `href`s to root paths from the page's own slug. */
export function remarkDocsLinks({ docsRoot }: { docsRoot: string }) {
  return (tree: TreeNode, file: { path: string }) => {
    const slug = path.relative(docsRoot, file.path).replace(/\.mdx$/, "");
    visitTree({
      node: tree,
      visitor: (node) => {
        if (node.type === "link" && node.url) node.url = absoluteHref({ href: node.url, slug });
        for (const attribute of node.attributes ?? []) {
          if (attribute.name === "href" && typeof attribute.value === "string")
            attribute.value = absoluteHref({ href: attribute.value, slug });
        }
      },
    });
  };
}
