import { readFileSync } from "node:fs";
import path from "node:path";

function classOf({ node }) {
  return node.attributes?.find((attribute) => attribute.name === "className")?.value ?? "";
}

function descendants({ node, match }) {
  return (node.children ?? []).flatMap((child) => [
    ...(match(child) ? [child] : []),
    ...descendants({ node: child, match }),
  ]);
}

function textOf({ node }) {
  return node.value ?? (node.children ?? []).map((child) => textOf({ node: child })).join("");
}

function attribute({ name, value }) {
  return { type: "mdxJsxAttribute", name, value };
}

function skillCard({ node }) {
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
    textOf({
      node: descendants({ node: command, match: (child) => child.name === "code" })[0] ?? command,
    }),
  );
  return {
    type: "mdxJsxFlowElement",
    name: "SkillCard",
    children: [],
    attributes: [
      attribute({ name: "title", value: title ? textOf({ node: title }) : "Skill" }),
      attribute({ name: "install", value: values[0] ?? "" }),
      attribute({ name: "command", value: values[1] ?? "" }),
      attribute({ name: "prompt", value: code?.value ?? "" }),
    ],
  };
}

function adaptSkillCards({ node }) {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    const classes = String(classOf({ node: child })).split(" ");
    if (classes.includes("lw-accordion")) return skillCard({ node: child });
    adaptSkillCards({ node: child });
    return child;
  });
}

function introduceSetup({ tree, file }) {
  if (!file.path?.endsWith("/introduction.mdx")) return;
  const group = tree.children.find((node) => node.name === "CardGroup");
  if (!group) return;
  const skills = readFileSync(path.join(path.dirname(file.path), "skills/directory.mdx"), "utf8");
  const prompt = skills.match(/````text\n([\s\S]*?)\n````/)?.[1];
  if (!prompt) return;
  group.name = "AgentQuickStart";
  group.attributes = [attribute({ name: "prompt", value: prompt })];
  group.children = [];
  const groupIndex = tree.children.indexOf(group);
  const introduction = tree.children[groupIndex - 1];
  if (introduction?.type === "paragraph") {
    tree.children.splice(groupIndex - 1, 1);
    tree.children.splice(groupIndex, 0, introduction);
  }
}

export function remarkDocsContent() {
  return (tree, file) => {
    adaptSkillCards({ node: tree });
    introduceSetup({ tree, file });
  };
}
