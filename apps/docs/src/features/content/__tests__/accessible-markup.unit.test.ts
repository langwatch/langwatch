import { describe, expect, it } from "vitest";

import type { TreeNode } from "../../../lib/syntax-tree.ts";
import { rehypeDocsHeadings } from "../compile/rehype-content.ts";

const jsx = ({ name, attributes = {} }: { name: string; attributes?: Record<string, string> }) =>
  ({
    type: "mdxJsxFlowElement",
    name,
    attributes: Object.entries(attributes).map(([key, value]) => ({
      type: "mdxJsxAttribute",
      name: key,
      value,
    })),
    children: [],
  }) satisfies TreeNode;

const h2 = (id: string): TreeNode => ({
  type: "element",
  tagName: "h2",
  properties: { id },
  children: [{ type: "text", value: id }],
});

const attribute = ({ node, name }: { node: TreeNode; name: string }) =>
  node.attributes?.find((attr) => attr.name === name)?.value;

describe("when components with titles come before the page's first h2", () => {
  /** @scenario "Component titles before the first section never skip a heading level" */
  it("gives them second-level titles, and leaves later and authored levels alone", () => {
    const step = jsx({ name: "Step", attributes: { title: "Install" } });
    const card = jsx({ name: "Card", attributes: { title: "Python" } });
    const skill = jsx({ name: "SkillCard", attributes: { title: "Trace" } });
    const sized = jsx({ name: "Step", attributes: { title: "Plain", titleSize: "p" } });
    const later = jsx({ name: "Card", attributes: { title: "Go" } });
    const tree: TreeNode = {
      type: "root",
      children: [step, card, skill, sized, h2("usage"), later],
    };
    rehypeDocsHeadings()(tree);
    expect(attribute({ node: step, name: "titleSize" })).toBe("h2");
    expect(attribute({ node: card, name: "titleLevel" })).toBe("2");
    expect(attribute({ node: skill, name: "titleLevel" })).toBe("2");
    expect(attribute({ node: sized, name: "titleSize" })).toBe("p");
    expect(attribute({ node: later, name: "titleLevel" })).toBeUndefined();
  });
});
