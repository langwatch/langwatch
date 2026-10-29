import { type CssNode, serializeStylesheet, splitSelectorList } from "./stylesheet.ts";

const DARK_CLASS = /(?<!\\)\.dark(?![\w-])/;
const DARK_CLASSES = new RegExp(DARK_CLASS.source, "g");

/* `.dark` is set by the head script, so a reader without JavaScript never gets it. This sheet
   repeats every `.dark` rule as `:root:where(:not(.light))` (same specificity as `.dark`) and is
   linked only inside <noscript> with a prefers-color-scheme: dark media query. */
export function darkFallbackCss({ nodes }: { nodes: CssNode[] }) {
  const rewrite = (list: CssNode[]): CssNode[] =>
    list.flatMap((node): CssNode[] => {
      if (node.kind === "verbatim") return [];
      if (node.kind === "group") {
        const children = rewrite(node.children);
        return children.length > 0 ? [{ ...node, children }] : [];
      }
      const dark = splitSelectorList({ selector: node.selector }).filter((complex) =>
        DARK_CLASS.test(complex),
      );
      if (dark.length === 0) return [];
      const selector = dark
        .map((complex) => complex.replaceAll(DARK_CLASSES, ":root:where(:not(.light))"))
        .join(",");
      return [{ ...node, selector }];
    });
  return `:root{color-scheme:dark}${serializeStylesheet({ nodes: rewrite(nodes) })}`;
}

export function darkFallbackHead({ href }: { href: string }) {
  return `<noscript><link rel="stylesheet" href="${href}" media="(prefers-color-scheme: dark)"></noscript>`;
}
