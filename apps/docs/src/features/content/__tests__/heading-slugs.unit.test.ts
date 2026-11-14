import { describe, expect, it } from "vitest";

import type { TreeNode } from "../../../lib/syntax-tree.ts";
import { rehypeDocsSlugs } from "../compile/rehype-content.ts";

function heading({ text }: { text: string }): TreeNode {
  return {
    type: "element",
    tagName: "h2",
    properties: {},
    children: [{ type: "text", value: text }],
  };
}

function card({ children }: { children: TreeNode[] }): TreeNode {
  return { type: "mdxJsxFlowElement", name: "SkillCard", attributes: [], children };
}

const idOf = (node: TreeNode | undefined) => node?.properties?.id;

describe("when a page's skill prompt repeats one of the page's section titles", () => {
  /** @scenario "Keep a page's own heading anchors when a skill prompt repeats a heading" */
  it("gives the page's section the plain anchor and the prompt's heading a numbered one", () => {
    const promptHeading = heading({ text: "Run parameters" });
    const pageHeading = heading({ text: "Run parameters" });
    const intro = heading({ text: "Getting started" });
    const wrapper: TreeNode = {
      type: "element",
      tagName: "div",
      properties: {},
      children: [card({ children: [promptHeading] })],
    };
    const tree: TreeNode = { type: "root", children: [intro, wrapper, pageHeading] };
    rehypeDocsSlugs()(tree);
    expect(idOf(pageHeading)).toBe("run-parameters");
    expect(idOf(promptHeading)).toBe("run-parameters-1");
    expect(idOf(intro)).toBe("getting-started");
  });

  /** @scenario "Keep a page's own heading anchors when a skill prompt repeats a heading" */
  it("puts every card back where it was", () => {
    const first = card({ children: [heading({ text: "A" })] });
    const second = card({ children: [heading({ text: "B" })] });
    const between = heading({ text: "Between" });
    const tree: TreeNode = { type: "root", children: [first, between, second] };
    rehypeDocsSlugs()(tree);
    expect(tree.children).toEqual([first, between, second]);
  });
});
