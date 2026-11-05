import { describe, expect, it } from "vitest";

import type { TreeNode } from "../../../lib/syntax-tree.ts";
import { rehypeDocsAccessibility, rehypeDocsHeadings } from "../compile/rehype-content.ts";

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

describe("when a page has a task list", () => {
  /** @scenario "Name each task list checkbox by its item" */
  it("labels each checkbox with its item's text, in tight and loose lists", () => {
    const box = (): TreeNode => ({
      type: "element",
      tagName: "input",
      properties: { type: "checkbox", disabled: true },
    });
    const tight = box();
    const loose = box();
    const tree: TreeNode = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "li",
          children: [tight, { type: "text", value: " Rotate   the key" }],
        },
        {
          type: "element",
          tagName: "li",
          children: [
            {
              type: "element",
              tagName: "p",
              children: [loose, { type: "text", value: " Back up" }],
            },
          ],
        },
      ],
    };
    rehypeDocsAccessibility()(tree);
    expect(tight.properties?.ariaLabel).toBe("Rotate the key");
    expect(loose.properties?.ariaLabel).toBe("Back up");
  });
});

describe("when a table's corner header cell is empty", () => {
  /** @scenario "Head each row of a table whose corner cell is empty" */
  it("makes each row's first cell its row header, and leaves other tables alone", () => {
    const cell = (tagName: string, value: string): TreeNode => ({
      type: "element",
      tagName,
      children: value ? [{ type: "text", value }] : [],
    });
    const table = (corner: string): TreeNode => ({
      type: "element",
      tagName: "table",
      children: [
        {
          type: "element",
          tagName: "thead",
          children: [
            {
              type: "element",
              tagName: "tr",
              children: [cell("th", corner), cell("th", "API key")],
            },
          ],
        },
        {
          type: "element",
          tagName: "tbody",
          children: [
            {
              type: "element",
              tagName: "tr",
              children: [cell("td", "Owner"), cell("td", "One user")],
            },
          ],
        },
      ],
    });
    const matrix = table("");
    const plain = table("Name");
    rehypeDocsAccessibility()({ type: "root", children: [matrix, plain] });
    const firstCell = (node: TreeNode) => node.children?.[1]?.children?.[0]?.children?.[0];
    expect(firstCell(matrix)).toMatchObject({ tagName: "th", properties: { scope: "row" } });
    expect(firstCell(matrix)?.children?.[0]?.value).toBe("Owner");
    expect(firstCell(plain)?.tagName).toBe("td");
  });
});
