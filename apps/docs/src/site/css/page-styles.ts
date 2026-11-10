import { createHash } from "node:crypto";

import {
  criticalCss,
  customPropertyNames,
  markupNames,
  scriptedNames,
  wordsOf,
} from "./critical.ts";
import { darkFallbackCss, darkFallbackHead } from "./dark-fallback.ts";
import { minifyCss } from "./minify.ts";
import { parseStylesheet, serializeStylesheet, type CssNode } from "./stylesheet.ts";

/* The page paints from the rules inlined in its head. The shared sheet (every server and island
   rule) names its address in `data-href`, so the browser does not ask for it until the page has
   loaded; the bootstrap then sets `href` (`afterLoad`). Without JavaScript the
   inlined rules alone style the page. */
export function styleHead({ css, href }: { css: string; href: string }) {
  return `<style>${css.replaceAll("</style", "<\\/style")}</style><link data-docs-style rel="stylesheet" data-href="${href}">`;
}

/* Words of the page's own `style` attributes, which may start an animation by name. */
function styleAttributeWords({ html }: { html: string }) {
  return wordsOf({
    text: Array.from(html.matchAll(/\sstyle="([^"]*)"/g), ([, style]) => style).join(" "),
  });
}

/* Every page inlines its font faces. Declared again in the sheet that arrives after load, a face
   with `font-display: optional` would swap in a font the page had already drawn without. */
function withoutFontFaces({ nodes }: { nodes: CssNode[] }): CssNode[] {
  return nodes.flatMap((node): CssNode[] => {
    if (node.kind === "verbatim") return /^\s*@font-face\b/i.test(node.text) ? [] : [node];
    if (node.kind === "rule") return [node];
    return [{ ...node, children: withoutFontFaces({ nodes: node.children }) }];
  });
}

/**
 * One hashed shared stylesheet from the server rules and the client CSS, and each page with
 * the rules its markup can match inlined in place of `placeholder`.
 */
export function inlinePageStyles({
  rules,
  clientCss,
  clientLinks,
  scripts,
  pages,
  placeholder,
  href,
}: {
  rules: string[];
  clientCss: string[];
  /** Client `<link rel="stylesheet">` tags the shared sheet replaces. */
  clientLinks: string[];
  /** Client bundle text, whose words name the classes and ids islands add at runtime. */
  scripts: string[];
  pages: Map<string, string>;
  placeholder: string;
  href: (file: string) => string;
}) {
  const css = minifyCss({ css: [...rules, ...clientCss].join("\n") });
  const nodes = parseStylesheet({ css });
  const shared = serializeStylesheet({ nodes: withoutFontFaces({ nodes }) });
  const file = `assets/docs-${createHash("sha256").update(shared).digest("hex").slice(0, 16)}.css`;
  const dark = darkFallbackCss({ nodes });
  const darkFile = `assets/docs-dark-${createHash("sha256").update(dark).digest("hex").slice(0, 16)}.css`;
  const names = new Map<string, Set<string>>();
  const known = new Set<string>();
  for (const page of new Set(pages.values())) {
    const found = markupNames({ html: page });
    names.set(page, found);
    for (const name of found) known.add(name);
  }
  const scripted = scriptedNames({ known, scripts });
  const scriptProperties = customPropertyNames({ text: scripts.join("\n") });
  const scriptWords = wordsOf({ text: scripts.join("\n") });
  const styled = new Map<string, string>();
  const output = new Map<string, string>();
  for (const [target, page] of pages) {
    let result = styled.get(page);
    if (result === undefined) {
      const inline = criticalCss({
        nodes,
        page: names.get(page) ?? new Set(),
        known,
        scripted,
        mentioned: new Set([...scriptProperties, ...customPropertyNames({ text: page })]),
        animationWords: new Set([...scriptWords, ...styleAttributeWords({ html: page })]),
      });
      result = clientLinks
        .reduce((markup, link) => markup.replace(link, ""), page)
        .replace(
          placeholder,
          styleHead({ css: inline, href: href(file) }) + darkFallbackHead({ href: href(darkFile) }),
        );
      styled.set(page, result);
    }
    output.set(target, result);
  }
  return {
    files: new Map([
      [file, shared],
      [darkFile, dark],
    ]),
    file,
    pages: output,
  };
}
