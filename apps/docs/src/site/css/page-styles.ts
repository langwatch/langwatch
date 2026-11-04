import { createHash } from "node:crypto";

import { criticalCss, customPropertyNames, markupNames, scriptedNames } from "./critical.ts";
import { darkFallbackCss, darkFallbackHead } from "./dark-fallback.ts";
import { minifyCss } from "./minify.ts";
import { parseStylesheet } from "./stylesheet.ts";

/* The page paints from the rules inlined in its head; the shared sheet (every server and island
   rule) loads as `print`, which never blocks rendering, then applies to all media once loaded.
   Without JavaScript the inlined rules alone style the page. */
export function styleHead({ css, href }: { css: string; href: string }) {
  return `<style>${css.replaceAll("</style", "<\\/style")}</style><link data-docs-style rel="stylesheet" href="${href}" media="print" onload="this.media='all'">`;
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
  const file = `assets/docs-${createHash("sha256").update(css).digest("hex").slice(0, 16)}.css`;
  const nodes = parseStylesheet({ css });
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
      [file, css],
      [darkFile, dark],
    ]),
    file,
    pages: output,
  };
}
