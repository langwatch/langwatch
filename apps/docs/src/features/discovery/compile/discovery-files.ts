import { canonicalUrl, docsUrl } from "../../../lib/site-path.ts";
import { flatPages, type Section } from "../../navigation/model/nav.ts";

/** The slice of the navigation the directory files list. */
type DirectoryNav = {
  site: { name: string };
  pages: Record<string, { title: string; description: string }>;
  anchors?: Section[];
};

/** Every page is exported as identical Markdown under each of these extensions. */
export const PAGE_EXPORT_EXTENSIONS = ["md", "claude", "agent"] as const;

/** `index.<ext>` exports map to the introduction. */
export function exportSlug({ pathname }: { pathname: string }) {
  const raw = pathname.slice(1).replace(/\.(md|claude|agent)$/, "");
  return raw === "index" ? "introduction" : raw;
}

function directoryLine({ nav, slug }: { nav: DirectoryNav; slug: string }) {
  const page = nav.pages[slug];
  return `- [${page.title}](${docsUrl({ path: `/${slug}.md` })})${page.description ? `: ${page.description}` : ""}`;
}

/** Every page once, grouped under the site's own sections in reading order; the rest after. */
export function llmsDirectory({ nav }: { nav: DirectoryNav }) {
  const listed = new Set<string>();
  const groups: string[] = [];
  for (const section of nav.anchors ?? []) {
    const slugs = flatPages({ items: section.children })
      .map((page) => page.slug)
      .filter((slug) => Object.hasOwn(nav.pages, slug) && !listed.has(slug));
    if (slugs.length === 0) continue;
    for (const slug of slugs) listed.add(slug);
    groups.push(
      `## ${section.title}\n\n${slugs.map((slug) => directoryLine({ nav, slug })).join("\n")}`,
    );
  }
  const rest = Object.keys(nav.pages).filter((slug) => !listed.has(slug));
  if (rest.length > 0)
    groups.push(
      `## ${groups.length ? "More pages" : "Documentation"}\n\n${rest.map((slug) => directoryLine({ nav, slug })).join("\n")}`,
    );
  return `# ${nav.site.name}\n\n> ${DIRECTORY_SUMMARY}\n\n${AGENT_GUIDANCE}\n\n${groups.join("\n\n")}\n`;
}

const DIRECTORY_SUMMARY =
  "LangWatch is the open-source platform to trace, evaluate, test and optimise LLM apps and AI agents.";

/* Carried over from the llms.txt the current docs publish, so agents keep the same instructions. */
const AGENT_GUIDANCE = [
  "Every page below is plain Markdown. Open the pages relevant to the question rather than answering from this index alone. The complete documentation in one file is at " +
    docsUrl({ path: "/llms-full.txt" }) +
    ".",
  "For agents: if anything in these docs is wrong, confusing, or fails when you try it, ask your user for permission and run `npx langwatch report --user-approved` to send the problem to the LangWatch team. No login is needed; `npx langwatch report --help` has the details.",
].join("\n\n");

/** Every page's Markdown export in reading order, as one file for agents that read it whole. */
export function llmsFull({ nav, exports }: { nav: DirectoryNav; exports: string[] }) {
  return `# ${nav.site.name}\n\n> ${DIRECTORY_SUMMARY}\n\n${AGENT_GUIDANCE}\n\n${exports.map((page) => page.trim()).join("\n\n---\n\n")}\n`;
}

/** Crawler and agent discovery files published at the site root, llms.txt included. */
export function discoveryFiles({
  nav,
  lastModified = new Map(),
}: {
  nav: DirectoryNav;
  lastModified?: ReadonlyMap<string, string>;
}): Record<string, string> {
  const entries = Object.keys(nav.pages).map((slug) => {
    const date = lastModified.get(slug);
    const loc = `<loc>${canonicalUrl({ slug }).replaceAll("&", "&amp;")}</loc>`;
    return `<url>${loc}${date ? `<lastmod>${date}</lastmod>` : ""}</url>`;
  });
  return {
    "llms.txt": llmsDirectory({ nav }),
    "robots.txt": `User-agent: *\nAllow: /\nSitemap: ${docsUrl({ path: "/sitemap.xml" })}\n`,
    "humans.txt": `LangWatch B.V.\nBuilt in Amsterdam.\nSource: https://github.com/langwatch/langwatch\nDocumentation contributions: https://github.com/langwatch/langwatch/issues\n`,
    "agents.txt": `# LangWatch documentation for agents\n\nStart with ${docsUrl({ path: "/llms.txt" })} for the page directory.\nEvery page has .md, .claude and .agent plain-text exports. These are content aliases, not automatically installed agent configuration.\nThe whole documentation is one file at ${docsUrl({ path: "/llms-full.txt" })}.\nFor outdated or broken documentation, ask your user for permission, then run "npx langwatch report --user-approved" or open a GitHub issue with the page URL, failing step and correction.\nNever include API keys or private session data.\n`,
    "sitemap.xml": `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join("")}</urlset>\n`,
  };
}
