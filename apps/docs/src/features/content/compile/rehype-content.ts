import path from "node:path";

import rehypeSlug from "rehype-slug";

import { idOf, textOf, visitTree, type TreeNode } from "../../../lib/syntax-tree.ts";
import { readImageSize } from "./image-size.ts";

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

function skillCardsOf({ node }: { node: TreeNode }): { parent: TreeNode; node: TreeNode }[] {
  return (node.children ?? []).flatMap((child) =>
    child.type === "mdxJsxFlowElement" && child.name === "SkillCard"
      ? [{ parent: node, node: child }]
      : skillCardsOf({ node: child }),
  );
}

/**
 * rehype-slug, with the page's own headings slugged before skill prompt headings: a prompt
 * repeating a section's title must not take the anchor the page's links and contents expect.
 * Each card is moved to the end of the tree for the one slugging pass, then put back.
 */
export function rehypeDocsSlugs() {
  const slug = rehypeSlug() as (tree: TreeNode) => void;
  return (tree: TreeNode) => {
    const cards = skillCardsOf({ node: tree }).map(({ parent, node }) => ({
      parent,
      node,
      index: parent.children?.indexOf(node) ?? -1,
    }));
    for (const { parent, index } of cards.toReversed()) parent.children?.splice(index, 1);
    tree.children?.push(...cards.map(({ node }) => node));
    slug(tree);
    tree.children?.splice(tree.children.length - cards.length, cards.length);
    for (const { parent, node, index } of cards) parent.children?.splice(index, 0, node);
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

const MEDIA: Record<string, string> = {
  img: "DocsImg",
  video: "DocsVideo",
  source: "DocsSource",
  iframe: "DocsIframe",
  a: "DocsAnchor",
  code: "DocsInlineCode",
};
const SIZED_DIRECTORIES = /^\/(images|media|logo)\/[^?#]+\.(png|jpe?g|gif|webp)$/i;

type Dimension = number | string | undefined;

function dimensionsOf({ node }: { node: TreeNode }): {
  src?: unknown;
  width?: unknown;
  height?: unknown;
} {
  if (node.type === "element") return node.properties ?? {};
  const read = (name: string) =>
    node.attributes?.find((attribute) => attribute.name === name)?.value;
  return { src: read("src"), width: read("width"), height: read("height") };
}

function setDimension({ node, name, value }: { node: TreeNode; name: string; value: number }) {
  if (node.type === "element") {
    node.properties = { ...node.properties, [name]: value };
    return;
  }
  const existing = node.attributes?.find((attribute) => attribute.name === name);
  if (existing) existing.value = String(value);
  else node.attributes?.push({ type: "mdxJsxAttribute", name, value: String(value) });
}

/** Local raster images get their intrinsic size so the browser reserves space before decoding. */
function sizeImage({ node, docsRoot }: { node: TreeNode; docsRoot: string }) {
  const { src, width, height } = dimensionsOf({ node });
  if (typeof src !== "string" || !SIZED_DIRECTORIES.test(src) || height !== undefined) return;
  const authored: Dimension =
    typeof width === "number" || typeof width === "string" ? width : undefined;
  if (width !== undefined && authored === undefined) return;
  if (typeof authored === "string" && !/^\d+(px)?$/.test(authored.trim())) return;
  const size = readImageSize({ file: path.join(docsRoot, decodeURIComponent(src)) });
  if (!size) return;
  const shown = authored === undefined ? size.width : Number.parseInt(String(authored), 10);
  if (authored === undefined) setDimension({ node, name: "width", value: size.width });
  setDimension({ node, name: "height", value: Math.round((shown * size.height) / size.width) });
}

function isImage({ node }: { node: TreeNode }) {
  if (node.type === "element") return node.tagName === "img";
  return (
    (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") && node.name === "img"
  );
}

/** Raw media tags and anchors skip the MDX component map; legacy `lw-` markup gets its adapter. */
export function rehypeDocsMedia({ docsRoot }: { docsRoot: string }) {
  return (tree: TreeNode) => {
    visitTree({
      node: tree,
      visitor: (node) => {
        if (isImage({ node })) sizeImage({ node, docsRoot });
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
