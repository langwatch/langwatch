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

/** Highlights every fenced block at build time into per-line HTML on the `pre` element. */
export function rehypeDocsCode() {
  return async (tree) => {
    const jobs = [];
    const visit = (node) => {
      if (node.type === "element" && node.tagName === "pre") {
        const code = node.children?.find(
          (child) => child.type === "element" && child.tagName === "code",
        );
        if (code) jobs.push({ pre: node, code });
        return;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
    for (const { pre, code } of jobs) {
      const className = [code.properties?.className ?? []].flat();
      const lang =
        className.find((name) => String(name).startsWith("language-"))?.slice("language-".length) ??
        "";
      const source = textOf({ node: code }).replace(/\n$/, "");
      const meta = parseFenceMeta({ meta: code.data?.meta });
      const lines =
        lang === "mermaid"
          ? source.split("\n").map(() => "")
          : await highlightLines({ code: source, lang });
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

/** Exports `headings` (h2, h3 and step titles) so the contents rail renders in the first HTML. */
export function rehypeDocsHeadings() {
  return (tree) => {
    const used = new Map();
    const headings = [];
    let sawH2 = false;
    const visit = (node) => {
      if (node.type === "element" && /^h[1-6]$/.test(node.tagName) && node.properties?.id) {
        used.set(String(node.properties.id), 1);
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
    const collect = (node) => {
      if (node.type === "element" && /^h[23]$/.test(node.tagName) && node.properties?.id) {
        const depth = Number(node.tagName[1]);
        if (depth === 2) sawH2 = true;
        headings.push({ depth, text: textOf({ node }).trim(), id: String(node.properties.id) });
      }
      if (
        (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
        node.name === "Step"
      ) {
        const title = node.attributes?.find(
          (attr) => attr.name === "title" && typeof attr.value === "string",
        );
        if (title) {
          let id = node.attributes.find((attr) => attr.name === "id")?.value;
          if (!id) {
            id = slugOf({ text: title.value, used });
            node.attributes.push({ type: "mdxJsxAttribute", name: "id", value: id });
          }
          headings.push({ depth: sawH2 ? 3 : 2, text: title.value, id });
        }
      }
      for (const child of node.children ?? []) collect(child);
    };
    collect(tree);
    tree.children.push({
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
    });
  };
}

const MEDIA = { img: "DocsImg", video: "DocsVideo", iframe: "DocsIframe" };

/** Raw `<img>`, `<video>` and `<iframe>` tags are not mapped by MDX, so route them to docs components. */
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
