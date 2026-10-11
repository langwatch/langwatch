import path from "node:path";

function absoluteHref({ href, slug }) {
  if (!/^\.{1,2}\//.test(href)) return href;
  const target = new URL(href, `https://docs.local/${slug}`);
  return `${target.pathname}${target.search}${target.hash}`;
}

function visitLinks({ node, slug }) {
  if (node.type === "link") node.url = absoluteHref({ href: node.url, slug });
  for (const attribute of node.attributes ?? []) {
    if (attribute.name === "href" && typeof attribute.value === "string")
      attribute.value = absoluteHref({ href: attribute.value, slug });
  }
  for (const child of node.children ?? []) visitLinks({ node: child, slug });
}

export function remarkDocsLinks({ docsRoot }) {
  return (tree, file) => {
    const slug = path.relative(docsRoot, file.path).replace(/\.mdx$/, "");
    visitLinks({ node: tree, slug });
  };
}
