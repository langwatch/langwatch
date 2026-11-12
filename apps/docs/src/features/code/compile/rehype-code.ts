import { textOf, visitTree, type TreeNode } from "../../../lib/syntax-tree.ts";
import { renderDiagram } from "./diagrams.ts";
import { highlightLines } from "./highlight.ts";

/** Parses a fence's meta: a tab or file title, `{1,3-5}` highlighted lines and flags. */
export function parseFenceMeta({ meta }: { meta?: string | null }) {
  let rest = meta ?? "";
  let title = "";
  const quoted = /title=(?:"([^"]*)"|'([^']*)')/.exec(rest);
  if (quoted) {
    title = quoted[1] ?? quoted[2] ?? "";
    rest = rest.replace(quoted[0], " ");
  }
  const highlight: number[] = [];
  const braces = /\{([\d,\s-]+)\}/.exec(rest);
  if (braces) {
    for (const part of (braces[1] ?? "").split(",")) {
      const [from = 0, to] = part.trim().split("-").map(Number);
      for (let line = from; line <= (to || from); line += 1) highlight.push(line);
    }
    rest = rest.replace(braces[0], " ");
  }
  const words = rest.split(/\s+/).filter(Boolean);
  const flags = words.filter((word) => ["lines", "wrap", "expandable"].includes(word));
  const label = words.filter((word) => !flags.includes(word) && !word.includes("=")).join(" ");
  return { title: title || label, highlight, flags };
}

function codeBlocks({ tree }: { tree: TreeNode }) {
  const blocks: { pre: TreeNode; code: TreeNode }[] = [];
  visitTree({
    node: tree,
    visitor: (node) => {
      if (node.type !== "element" || node.tagName !== "pre") return;
      const code = node.children?.find(
        (child) => child.type === "element" && child.tagName === "code",
      );
      if (code) blocks.push({ pre: node, code });
    },
  });
  return blocks;
}

/** Replaces a fence's children with the build-time lines, meta and diagrams CodeBlock renders. */
async function highlightBlock({ pre, code }: { pre: TreeNode; code: TreeNode }) {
  const className = [code.properties?.className ?? []].flat().map(String);
  const lang =
    className.find((name) => name.startsWith("language-"))?.slice("language-".length) ?? "";
  const source = textOf({ node: code }).replace(/\n$/, "");
  const meta = parseFenceMeta({ meta: code.data?.meta as string | undefined });
  const lines = lang === "mermaid" ? [] : await highlightLines({ code: source, lang });
  const properties: Record<string, unknown> = {
    dataLang: lang,
    dataTitle: meta.title,
    dataCode: source,
    dataLines: JSON.stringify(lines),
    dataHighlight: meta.highlight.join(","),
    dataFlags: meta.flags.join(","),
  };
  if (lang === "mermaid") {
    const diagram = await renderDiagram({ source });
    properties.dataDiagramLight = diagram.light;
    properties.dataDiagramDark = diagram.dark;
  }
  pre.properties = properties;
  pre.children = [];
}

export function rehypeDocsCode() {
  return async (tree: TreeNode) => {
    for (const block of codeBlocks({ tree })) await highlightBlock(block);
  };
}
