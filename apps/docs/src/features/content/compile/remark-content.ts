import { readFileSync } from "node:fs";
import path from "node:path";

import type { TreeAttribute, TreeNode } from "../../../lib/syntax-tree.ts";

function classOf({ node }: { node: TreeNode }) {
  const value = node.attributes?.find((attribute) => attribute.name === "className")?.value;
  return typeof value === "string" ? value : "";
}

function descendants({
  node,
  match,
}: {
  node: TreeNode;
  match: (node: TreeNode) => boolean;
}): TreeNode[] {
  return (node.children ?? []).flatMap((child) => [
    ...(match(child) ? [child] : []),
    ...descendants({ node: child, match }),
  ]);
}

/** Every literal under a node, inline code and expressions included. */
function literalText({ node }: { node: TreeNode }): string {
  return node.value ?? (node.children ?? []).map((child) => literalText({ node: child })).join("");
}

function attribute({ name, value }: { name: string; value: string }): TreeAttribute {
  return { type: "mdxJsxAttribute", name, value };
}

/** Legacy `lw-accordion` skill markup becomes a `<SkillCard>`: title, commands and prompt. */
function skillCard({ node }: { node: TreeNode }): TreeNode {
  const title = descendants({
    node,
    match: (child) => classOf({ node: child }) === "lw-accordion-title",
  })[0];
  const commands = descendants({
    node,
    match: (child) => classOf({ node: child }) === "lw-accordion-cmd-box",
  });
  const prompt = descendants({
    node,
    match: (child) => classOf({ node: child }) === "lw-prompt-source",
  })[0];
  const code = prompt && descendants({ node: prompt, match: (child) => child.type === "code" })[0];
  const values = commands.map((command) =>
    literalText({
      node: descendants({ node: command, match: (child) => child.name === "code" })[0] ?? command,
    }),
  );
  return {
    type: "mdxJsxFlowElement",
    name: "SkillCard",
    children: [],
    attributes: [
      attribute({ name: "title", value: title ? literalText({ node: title }) : "Skill" }),
      attribute({ name: "install", value: values[0] ?? "" }),
      attribute({ name: "command", value: values[1] ?? "" }),
      attribute({ name: "prompt", value: code?.value ?? "" }),
    ],
  };
}

function adaptSkillCards({ node }: { node: TreeNode }) {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    const classes = classOf({ node: child }).split(" ");
    if (classes.includes("lw-accordion")) return skillCard({ node: child });
    adaptSkillCards({ node: child });
    return child;
  });
}

/** The introduction's card group becomes the agent setup panel, fed the skills directory prompt. */
function introduceSetup({ tree, file }: { tree: TreeNode; file: { path?: string } }) {
  if (!file.path?.endsWith("/introduction.mdx")) return;
  const children = tree.children ?? [];
  const group = children.find((node) => node.name === "CardGroup");
  if (!group) return;
  const skills = readFileSync(path.join(path.dirname(file.path), "skills/directory.mdx"), "utf8");
  const prompt = skills.match(/````text\n([\s\S]*?)\n````/)?.[1];
  if (!prompt) return;
  group.name = "AgentQuickStart";
  group.attributes = [attribute({ name: "prompt", value: prompt })];
  group.children = [];
  const groupIndex = children.indexOf(group);
  const introduction = children[groupIndex - 1];
  if (introduction?.type === "paragraph") {
    children.splice(groupIndex - 1, 1);
    children.splice(groupIndex, 0, introduction);
  }
}

export function remarkDocsContent() {
  return (tree: TreeNode, file: { path?: string }) => {
    adaptSkillCards({ node: tree });
    introduceSetup({ tree, file });
  };
}
