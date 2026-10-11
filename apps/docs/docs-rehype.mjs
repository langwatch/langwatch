import { renderDiagram } from "./docs-diagrams.mjs";
import { highlightLines } from "./docs-highlight.mjs";

function textOf({ node }) {
  if (node.type === "text") return node.value;
  return (node.children ?? []).map((child) => textOf({ node: child })).join("");
}

/** Parses a fence's meta: a tab or file title, `{1,3-5}` highlighted lines and flags. */
export function parseFenceMeta({ meta }) {
  let rest = meta ?? "";
  let title = "";
  const quoted = /title=(?:"([^"]*)"|'([^']*)')/.exec(rest);
  if (quoted) {
    title = quoted[1] ?? quoted[2];
    rest = rest.replace(quoted[0], " ");
  }
  const highlight = [];
  const braces = /\{([\d,\s-]+)\}/.exec(rest);
  if (braces) {
    for (const part of braces[1].split(",")) {
      const [from, to] = part.trim().split("-").map(Number);
      for (let line = from; line <= (to || from); line += 1) highlight.push(line);
    }
    rest = rest.replace(braces[0], " ");
  }
  const words = rest.split(/\s+/).filter(Boolean);
  const flags = words.filter((word) => ["lines", "wrap", "expandable"].includes(word));
  const label = words.filter((word) => !flags.includes(word) && !word.includes("=")).join(" ");
  return { title: title || label, highlight, flags };
}

function visitTree({ node, visitor }) {
  visitor(node);
  for (const child of node.children ?? []) visitTree({ node: child, visitor });
}

function codeBlocks({ tree }) {
  const blocks = [];
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

async function highlightBlock({ pre, code }) {
  const className = [code.properties?.className ?? []].flat();
  const lang =
    className.find((name) => String(name).startsWith("language-"))?.slice("language-".length) ?? "";
  const source = textOf({ node: code }).replace(/\n$/, "");
  const meta = parseFenceMeta({ meta: code.data?.meta });
  const lines = lang === "mermaid" ? [] : await highlightLines({ code: source, lang });
  pre.properties = {
    dataLang: lang,
    dataTitle: meta.title,
    dataCode: source,
    dataLines: JSON.stringify(lines),
    dataHighlight: meta.highlight.join(","),
    dataFlags: meta.flags.join(","),
  };
  if (lang === "mermaid") {
    const diagram = await renderDiagram({ source });
    pre.properties.dataDiagramLight = diagram.light;
    pre.properties.dataDiagramDark = diagram.dark;
  }
  pre.children = [];
}

export function rehypeDocsCode() {
  return async (tree) => {
    for (const block of codeBlocks({ tree })) await highlightBlock(block);
  };
}

function slugOf({ text, used }) {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

function estreeOf({ value }) {
  if (Array.isArray(value))
    return { type: "ArrayExpression", elements: value.map((item) => estreeOf({ value: item })) };
  if (value && typeof value === "object") {
    return {
      type: "ObjectExpression",
      properties: Object.entries(value).map(([key, item]) => ({
        type: "Property",
        kind: "init",
        method: false,
        shorthand: false,
        computed: false,
        key: { type: "Literal", value: key },
        value: estreeOf({ value: item }),
      })),
    };
  }
  return { type: "Literal", value };
}

function collectStep({ node, state }) {
  if (!["mdxJsxFlowElement", "mdxJsxTextElement"].includes(node.type) || node.name !== "Step")
    return;
  const title = node.attributes?.find(
    (attr) => attr.name === "title" && typeof attr.value === "string",
  );
  if (!title) return;
  let id = node.attributes.find((attr) => attr.name === "id")?.value;
  if (!id) {
    id = slugOf({ text: title.value, used: state.used });
    node.attributes.push({ type: "mdxJsxAttribute", name: "id", value: id });
  }
  state.headings.push({ depth: state.sawH2 ? 3 : 2, text: title.value, id });
}

function collectHeading({ node, state }) {
  if (node.type === "element" && /^h[23]$/.test(node.tagName) && node.properties?.id) {
    const depth = Number(node.tagName[1]);
    if (depth === 2) state.sawH2 = true;
    state.headings.push({ depth, text: textOf({ node }).trim(), id: String(node.properties.id) });
  }
  collectStep({ node, state });
}

export function rehypeDocsHeadings() {
  return (tree) => {
    const state = { used: new Map(), headings: [], sawH2: false };
    visitTree({
      node: tree,
      visitor: (node) => {
        if (node.type === "element" && /^h[1-6]$/.test(node.tagName) && node.properties?.id)
          state.used.set(String(node.properties.id), 1);
      },
    });
    visitTree({ node: tree, visitor: (node) => collectHeading({ node, state }) });
    tree.children.push(headingsExport({ headings: state.headings }));
  };
}

function headingsExport({ headings }) {
  return {
    type: "mdxjsEsm",
    value: "export const headings = []",
    data: {
      estree: {
        type: "Program",
        sourceType: "module",
        body: [
          {
            type: "ExportNamedDeclaration",
            specifiers: [],
            declaration: {
              type: "VariableDeclaration",
              kind: "const",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: { type: "Identifier", name: "headings" },
                  init: estreeOf({ value: headings }),
                },
              ],
            },
          },
        ],
      },
    },
  };
}

const MEDIA = { img: "DocsImg", video: "DocsVideo", iframe: "DocsIframe" };

/** Raw media tags bypass MDX component mappings. */
export function rehypeDocsMedia() {
  return (tree) => {
    const visit = (node) => {
      if (
        (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
        MEDIA[node.name]
      )
        node.name = MEDIA[node.name];
      const legacy = node.attributes?.some(
        (attribute) => attribute.name === "className" && String(attribute.value).includes("lw-"),
      );
      if (node.name === "div" && legacy) node.name = "LegacyContent";
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
  };
}
