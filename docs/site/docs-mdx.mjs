import path from "node:path";

import mdx from "@mdx-js/rollup";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";

import { remarkDocsContent } from "./docs-content.mjs";
import { closeDiagrams } from "./docs-diagrams.mjs";
import { remarkDocsLinks } from "./docs-links.mjs";
import { rehypeDocsCode, rehypeDocsHeadings, rehypeDocsMedia } from "./docs-rehype.mjs";

export function docsMdxPlugin({ docsRoot }) {
  const inner = mdx({
    providerImportSource: "@mdx-js/react",
    remarkPlugins: [
      remarkFrontmatter,
      [remarkMdxFrontmatter, { name: "frontmatter" }],
      remarkGfm,
      remarkDocsContent,
      [remarkDocsLinks, { docsRoot }],
    ],
    rehypePlugins: [rehypeSlug, rehypeDocsMedia, rehypeDocsCode, rehypeDocsHeadings],
  });
  const innerTransform = inner.transform;
  const handler = typeof innerTransform === "function" ? innerTransform : innerTransform.handler;
  return {
    ...inner,
    enforce: "pre",
    closeBundle: closeDiagrams,
    configureServer(server) {
      server.httpServer?.once("close", closeDiagrams);
    },
    transform: {
      filter: { id: /\.mdx$/ },
      async handler(code, id) {
        if (!id.endsWith(".mdx")) return null;
        if (id.endsWith("/introduction.mdx"))
          this.addWatchFile(path.join(docsRoot, "skills/directory.mdx"));
        return handler.call(this, code, id);
      },
    },
  };
}
