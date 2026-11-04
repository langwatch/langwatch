import { describe, expect, it } from "vitest";

import type { TreeNode } from "../../../lib/syntax-tree.ts";
import { rehypeDocsMedia } from "../compile/rehype-content.ts";
import { DocsAnchor } from "../ui/prose.tsx";

describe("when a page authors a raw <a>", () => {
  /** @scenario "Build the documentation under a base path" */
  it("renders it through DocsAnchor, which writes the href under the mount", () => {
    const anchor: TreeNode = {
      type: "mdxJsxTextElement",
      name: "a",
      attributes: [{ type: "mdxJsxAttribute", name: "href", value: "/coding-agents/overview" }],
      children: [],
    };
    const link: TreeNode = { type: "element", tagName: "a", properties: { href: "/x" } };
    rehypeDocsMedia({ docsRoot: "/unused" })({ type: "root", children: [anchor, link] });
    expect(anchor.name).toBe("DocsAnchor");
    expect(link.tagName).toBe("a");
    const element = DocsAnchor({ href: "/coding-agents/overview", className: "caption" });
    expect(element.props).toMatchObject({ href: "/coding-agents/overview", className: "caption" });
  });
});
