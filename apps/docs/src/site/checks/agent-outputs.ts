import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { DOCS_URL } from "../../lib/site-path.ts";
import { filesUnder, type BuildIndex } from "./build-index.ts";
import { linkIssue, type LinkIssue } from "./resolve.ts";

const DISCOVERY_FILES = ["llms.txt", "llms-full.txt", "agents.txt", "robots.txt", "sitemap.xml"];
const DOCS_LINK =
  /https:\/\/(?:langwatch\.ai\/docs|docs\.langwatch\.ai)(?=[/?#\s)\]>"'`<]|$)[^\s)\]>"'`<]*/g;

/** Every documentation address in a text file, with trailing sentence punctuation dropped. */
export function docsLinks({ text }: { text: string }) {
  return [
    ...new Set([...text.matchAll(DOCS_LINK)].map((match) => match[0].replace(/[.,;:!?*]+$/, ""))),
  ];
}

/** The agent-facing files of a build: each page's `.md` export and the discovery files. */
function agentFiles({ outDir }: { outDir: string }) {
  const exports = filesUnder({ directory: outDir, keep: (name) => name.endsWith(".md") });
  const discovery = DISCOVERY_FILES.map((name) => path.join(outDir, name)).filter((file) =>
    existsSync(file),
  );
  return [...exports, ...discovery];
}

/** Every documentation address an agent output names must resolve in this build. */
export function checkAgentOutputs({ index }: { index: BuildIndex }) {
  const issues: LinkIssue[] = [];
  const verdicts = new Map<string, string | null>();
  let checked = 0;
  for (const file of agentFiles({ outDir: index.outDir })) {
    const source = `/${path.relative(index.outDir, file).split(path.sep).join("/")}`;
    for (const href of docsLinks({ text: readFileSync(file, "utf8") })) {
      checked += 1;
      if (!verdicts.has(href)) verdicts.set(href, linkIssue({ href, source: "/", index }));
      const code = verdicts.get(href);
      if (code) issues.push({ source, href, code });
    }
  }
  return { checked, issues };
}

/** The sitemap's locations, unescaped. */
export function sitemapLocations({ xml }: { xml: string }) {
  return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) =>
    (match[1] ?? "").replace(/&amp;/g, "&"),
  );
}

function addressShape({ loc }: { loc: string }) {
  if (!loc.startsWith(`${DOCS_URL}/`)) return "sitemap-foreign-address";
  if (loc.endsWith("/")) return "sitemap-trailing-slash";
  if (loc.endsWith("/index")) return "sitemap-index-suffix";
  return null;
}

function locationIssue({ index, loc }: { index: BuildIndex; loc: string }) {
  const shape = addressShape({ loc });
  if (shape) return shape;
  const facts = index.html.get(path.join(index.outDir, loc.slice(DOCS_URL.length), "index.html"));
  if (!facts || facts.isRedirect) return "sitemap-not-page";
  return facts.canonical === loc ? null : "sitemap-not-canonical";
}

/** Sitemap entries are the canonical addresses of the pages they name, and every page is listed. */
export function checkSitemap({ index }: { index: BuildIndex }) {
  const file = path.join(index.outDir, "sitemap.xml");
  if (!existsSync(file))
    return { checked: 0, issues: [{ source: "/sitemap.xml", href: "", code: "missing-sitemap" }] };
  const locations = sitemapLocations({ xml: readFileSync(file, "utf8") });
  const listed = new Set(locations);
  const issues: LinkIssue[] = [];
  const report = (href: string, code: string) =>
    issues.push({ source: "/sitemap.xml", href, code });
  for (const loc of locations) {
    const code = locationIssue({ index, loc });
    if (code) report(loc, code);
  }
  for (const [page, facts] of index.html) {
    if (facts.isRedirect || facts.isNoindex || !facts.canonical) continue;
    if (path.basename(page) !== "index.html") continue;
    if (!listed.has(facts.canonical)) report(facts.canonical, "sitemap-missing-page");
  }
  return { checked: locations.length, issues };
}
