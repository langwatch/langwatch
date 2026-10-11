import mdx from "@mdx-js/rollup";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";

import { remarkDocsContent } from "./docs-content.mjs";
import { closeDiagrams } from "./docs-diagrams.mjs";
import { rehypeDocsCode, rehypeDocsHeadings, rehypeDocsMedia } from "./docs-rehype.mjs";

const FAILED_MODULE =
  "export const frontmatter = {};\nexport const headings = [];\nexport const failed = true;\nexport default function Failed() { return null; }\n";

/** MDX compiler that turns a compile error into a logged skip instead of a failed build. */
export function docsMdxPlugin({ failures }) {
  const inner = mdx({
    providerImportSource: "@mdx-js/react",
    remarkPlugins: [
      remarkFrontmatter,
      [remarkMdxFrontmatter, { name: "frontmatter" }],
      remarkGfm,
      remarkDocsContent,
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
        try {
          return await handler.call(this, code, id);
        } catch (error) {
          const message = String(error?.reason ?? error?.message ?? error).split("\n")[0];
          if (!failures.has(id)) {
            failures.set(id, message);
            console.warn(`[docs-site] skipped ${id}: ${message}`);
          }
          return { code: FAILED_MODULE, map: null };
        }
      },
    },
  };
}
