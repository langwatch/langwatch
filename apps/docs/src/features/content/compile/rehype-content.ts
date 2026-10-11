import { idOf, textOf, visitTree, type TreeNode } from "../../../lib/syntax-tree.ts";

export type Heading = { depth: number; text: string; id: string };
type HeadingState = { used: Map<string, number>; headings: Heading[]; sawH2: boolean };
type Literal = null | boolean | number | string | Literal[] | { [key: string]: Literal };

function slugOf({ text, used }: { text: string; used: Map<string, number> }) {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

function estreeOf({ value }: { value: Literal }): object {
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

/** A titled `<Step>` is a contents entry: h2 depth until the page's first h2, then h3. */
function collectStep({ node, state }: { node: TreeNode; state: HeadingState }) {
  if (!["mdxJsxFlowElement", "mdxJsxTextElement"].includes(node.type) || node.name !== "Step")
    return;
  const attribute = (name: string) => {
    const value = node.attributes?.find((attr) => attr.name === name)?.value;
    return typeof value === "string" ? value : undefined;
  };
  const title = attribute("title");
  if (title === undefined) return;
  let id = attribute("id");
  if (!id) {
    id = slugOf({ text: title, used: state.used });
    node.attributes?.push({ type: "mdxJsxAttribute", name: "id", value: id });
  }
  state.headings.push({ depth: state.sawH2 ? 3 : 2, text: title, id });
}

function collectHeading({ node, state }: { node: TreeNode; state: HeadingState }) {
  const id = idOf({ node });
  if (node.type === "element" && /^h[23]$/.test(node.tagName ?? "") && id) {
    const depth = Number(node.tagName?.[1]);
    if (depth === 2) state.sawH2 = true;
    state.headings.push({ depth, text: textOf({ node }).trim(), id });
  }
  collectStep({ node, state });
}

function headingsExport({ headings }: { headings: Heading[] }): TreeNode {
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

/** Exports `headings` from every page module for its contents rail and search anchors. */
export function rehypeDocsHeadings() {
  return (tree: TreeNode) => {
    const state: HeadingState = { used: new Map(), headings: [], sawH2: false };
    visitTree({
      node: tree,
      visitor: (node) => {
        const id = idOf({ node });
        if (node.type === "element" && /^h[1-6]$/.test(node.tagName ?? "") && id)
          state.used.set(id, 1);
      },
    });
    visitTree({ node: tree, visitor: (node) => collectHeading({ node, state }) });
    tree.children?.push(headingsExport({ headings: state.headings }));
  };
}

const MEDIA: Record<string, string> = { img: "DocsImg", video: "DocsVideo", iframe: "DocsIframe" };

/** Raw media tags bypass MDX component mappings; legacy `lw-` markup gets its adapter. */
export function rehypeDocsMedia() {
  return (tree: TreeNode) => {
    visitTree({
      node: tree,
      visitor: (node) => {
        if (
          (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
          node.name &&
          MEDIA[node.name]
        )
          node.name = MEDIA[node.name];
        const legacy = node.attributes?.some(
          (attribute) =>
            attribute.name === "className" &&
            typeof attribute.value === "string" &&
            attribute.value.includes("lw-"),
        );
        if (node.name === "div" && legacy) node.name = "LegacyContent";
      },
    });
  };
}
