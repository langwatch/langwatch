import path from "node:path";

import mdx from "@mdx-js/rollup";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import type { Plugin } from "vite";

import { closeDiagrams } from "../../code/compile/diagrams.ts";
import { rehypeDocsCode } from "../../code/compile/rehype-code.ts";
import { changelogPath, withReleaseNotes } from "../../releases/compile/releases.ts";
import { rehypeDocsHeadings, rehypeDocsMedia } from "./rehype-content.ts";
import { remarkDocsContent } from "./remark-content.ts";
import { remarkDocsLinks } from "./remark-links.ts";

/** Compiles authored MDX at build time: docs adapters, links, highlighting, diagrams, headings. */
export function docsMdxPlugin({ docsRoot }: { docsRoot: string }): Plugin {
  const inner = mdx({
    providerImportSource: "@mdx-js/react",
    remarkPlugins: [
      remarkFrontmatter,
      [remarkMdxFrontmatter, { name: "frontmatter" }],
      remarkGfm,
      remarkDocsContent,
      [remarkDocsLinks, { docsRoot }],
    ],
    rehypePlugins: [
      rehypeSlug,
      [rehypeDocsMedia, { docsRoot }],
      rehypeDocsCode,
      rehypeDocsHeadings,
    ],
  });
  const compile = inner.transform;
  if (typeof compile !== "function") throw new Error("@mdx-js/rollup exposes no transform");
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
        this.addWatchFile(changelogPath({ docsRoot }));
        const slug = path
          .relative(docsRoot, id)
          .replace(/\\/g, "/")
          .replace(/\.mdx$/, "");
        return compile.call(this, withReleaseNotes({ source: code, slug, docsRoot }), id);
      },
    },
  };
}
