import { expect, it } from "vitest";

import type { TreeNode } from "../../../lib/syntax-tree.ts";
import { remarkDocsContent } from "../compile/remark-content.ts";

/** @scenario "Read skill prompts as Markdown while preserving the copied source" */
it("parses prose and fences without executing prompt MDX", () => {
  const prompt =
    '# Setup\n\nUse **tracing** and `LANGWATCH_API_KEY`.\n\n```python\nprint("hello")\n```\n\n<script>alert(1)</script>';
  const tree: TreeNode = {
    type: "root",
    children: [
      {
        type: "mdxJsxFlowElement",
        name: "div",
        attributes: [{ name: "className", value: "lw-accordion" }],
        children: [
          {
            type: "mdxJsxFlowElement",
            name: "div",
            attributes: [{ name: "className", value: "lw-prompt-source" }],
            children: [{ type: "code", value: prompt }],
          },
        ],
      },
    ],
  };
  remarkDocsContent()(tree, {});
  const card = tree.children?.[0];
  expect(card?.name).toBe("SkillCard");
  expect(card?.attributes?.find((attribute) => attribute.name === "prompt")?.value).toBe(prompt);
  expect(card?.children?.[0]?.data?.hName).toBe("h4");
  expect(
    card?.children?.some((node) => node.type === "code" && node.value === 'print("hello")'),
  ).toBe(true);
  const text = JSON.stringify(card?.children);
  expect(text).toContain('"type":"strong"');
  expect(text).toContain('"type":"inlineCode"');
  expect(text).not.toContain('"type":"html"');
  expect(text).not.toContain('"type":"mdxJsxFlowElement"');
});
