import { describe, expect, it } from "vitest";

import { remarkDocsLinks } from "../docs-links.mjs";

describe("when authored links are relative to the MDX source", () => {
  /** @scenario "Resolve relative links independently of trailing slashes" */
  it("normalises Markdown and MDX hrefs while preserving fragments and external URLs", () => {
    const tree = {
      children: [
        { type: "link", url: "../concepts?view=full#traces" },
        { type: "link", url: "#install" },
        { type: "link", url: "https://example.com/help" },
        { type: "mdxJsxFlowElement", attributes: [{ name: "href", value: "./custom" }] },
      ],
    };
    remarkDocsLinks({ docsRoot: "/docs" })(tree, { path: "/docs/user-events/overview.mdx" });
    expect(tree.children).toEqual([
      { type: "link", url: "/concepts?view=full#traces" },
      { type: "link", url: "#install" },
      { type: "link", url: "https://example.com/help" },
      { type: "mdxJsxFlowElement", attributes: [{ name: "href", value: "/user-events/custom" }] },
    ]);
  });
});
