import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  namedFragments,
  PROMPT_FRAGMENT_FILE,
} from "../../features/content/compile/skill-prompts.ts";
import { readBuiltRedirects, type Redirects } from "../../features/navigation/compile/redirects.ts";

/** What the checks need from one built HTML file, read once. */
export type HtmlFacts = {
  ids: Set<string>;
  hrefs: string[];
  media: string[];
  canonical: string | null;
  isRedirect: boolean;
  isNoindex: boolean;
};

/** A finished build: its redirects, every HTML file's facts and the pages it publishes. */
export type BuildIndex = {
  outDir: string;
  basePath: string;
  redirects: Redirects;
  html: Map<string, HtmlFacts>;
  pages: string[];
};

/** Every file under a directory whose name passes `keep`, depth first in name order. */
export function filesUnder({
  directory,
  keep,
}: {
  directory: string;
  keep: (name: string) => boolean;
}): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries
    .toSorted((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return filesUnder({ directory: file, keep });
      return keep(entry.name) ? [file] : [];
    });
}

export function attributes({ html, attribute }: { html: string; attribute: string }) {
  const pattern = new RegExp(`\\s${attribute}=["']([^"']*)["']`, "gi");
  return [...html.matchAll(pattern)].map((match) => match[1].replace(/&amp;/g, "&"));
}

const MEDIA_ATTRIBUTES = ["src", "poster", "data-src"];

function mediaAddresses({ html }: { html: string }) {
  const candidates = attributes({ html, attribute: "srcset" }).flatMap((set) =>
    set.split(",").map((candidate) => candidate.trim().split(/\s+/)[0] ?? ""),
  );
  return [
    ...new Set([
      ...MEDIA_ATTRIBUTES.flatMap((attribute) => attributes({ html, attribute })),
      ...candidates,
    ]),
  ];
}

export function htmlFacts({ html }: { html: string }): HtmlFacts {
  const canonical = /<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i.exec(html)?.[1];
  return {
    ids: new Set(attributes({ html, attribute: "id" })),
    hrefs: [...new Set(attributes({ html, attribute: "href" }))],
    media: mediaAddresses({ html }),
    canonical: canonical?.replace(/&amp;/g, "&") ?? null,
    isRedirect: /<meta\s+http-equiv=["']refresh["']/i.test(html),
    isNoindex: /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html),
  };
}

/**
 * The site path an HTML file is served at: `a/b/index.html` -> `/a/b/`, `404.html` ->
 * `/404.html`.
 */
export function servedPath({ outDir, file }: { outDir: string; file: string }) {
  return `/${path
    .relative(outDir, file)
    .split(path.sep)
    .join("/")
    .replace(/index\.html$/, "")}`;
}

/** A published page's site path without a trailing slash; "/" is the home. */
function pagePathOf({ served }: { served: string }) {
  return served === "/" ? "/" : served.replace(/\/$/, "");
}

/** Reads every HTML file of a build once; pages are `index.html` files that are not redirects. */
export function readBuildIndex({ outDir, basePath }: { outDir: string; basePath: string }) {
  const html = new Map<string, HtmlFacts>();
  const pages: string[] = [];
  const isFragment = (file: string) =>
    PROMPT_FRAGMENT_FILE.test(path.relative(outDir, file).split(path.sep).join("/"));
  for (const file of filesUnder({ directory: outDir, keep: (name) => name.endsWith(".html") })) {
    if (isFragment(file)) continue;
    const markup = readFileSync(file, "utf8");
    const facts = htmlFacts({ html: markup });
    /* A prompt fragment is filled into the page naming it: its ids and links are that page's. */
    for (const name of namedFragments({ html: markup, basePath })) {
      const fragment = htmlFacts({ html: readFileSync(path.join(outDir, name), "utf8") });
      for (const id of fragment.ids) facts.ids.add(id);
      facts.hrefs = [...new Set([...facts.hrefs, ...fragment.hrefs])];
      facts.media = [...new Set([...facts.media, ...fragment.media])];
    }
    html.set(file, facts);
    if (path.basename(file) === "index.html" && !facts.isRedirect)
      pages.push(pagePathOf({ served: servedPath({ outDir, file }) }));
  }
  const redirects = readBuiltRedirects({ outDir });
  return { outDir, basePath, redirects, html, pages: pages.toSorted() } satisfies BuildIndex;
}
