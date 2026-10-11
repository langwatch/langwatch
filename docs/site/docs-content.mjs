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

export function remarkDocsContent() {
  return (tree, file) => {
    const visit = (node) => {
      if (!node.children) return;
      node.children = node.children.map((child) => {
        const classes = String(classOf({ node: child })).split(" ");
        if (classes.includes("lw-accordion")) return skillCard({ node: child });
        visit(child);
        return child;
      });
    };
    visit(tree);
    if (!file.path?.endsWith("/introduction.mdx")) return;
    const videoIndex = tree.children.findIndex((node) => node.name === "video");
    if (videoIndex < 0) return;
    const [video] = tree.children.splice(videoIndex, 1);
    const groupIndex = tree.children.findIndex((node) => node.name === "CardGroup");
    tree.children.splice(groupIndex + 1, 0, video);
    const intro = tree.children[groupIndex - 1];
    if (intro?.type === "paragraph") {
      tree.children.splice(groupIndex - 1, 1);
      tree.children.splice(groupIndex, 0, intro);
    }
  };
}
