import { flatPages, type Section } from "../../navigation/model/nav.ts";
import { canonicalUrl, DOCS_ORIGIN as origin } from "./page-head.ts";

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
  return `- [${page.title}](${origin}/${slug}.md)${page.description ? `: ${page.description}` : ""}`;
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
  const intro = `Every page below is plain Markdown. Report outdated or broken pages as a GitHub issue: https://github.com/langwatch/langwatch/issues`;
  return `# ${nav.site.name}\n\n> ${intro}\n\n${groups.join("\n\n")}\n`;
}

/** Crawler and agent discovery files published at the site root, llms.txt included. */
export function discoveryFiles({ nav }: { nav: DirectoryNav }): Record<string, string> {
  const urls = Object.keys(nav.pages).map((slug) => canonicalUrl({ slug }));
  return {
    "llms.txt": llmsDirectory({ nav }),
    "robots.txt": `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
    "humans.txt": `LangWatch B.V.\nBuilt in Amsterdam.\nSource: https://github.com/langwatch/langwatch\nDocumentation contributions: https://github.com/langwatch/langwatch/issues\n`,
    "agents.txt": `# LangWatch documentation for agents\n\nStart with ${origin}/llms.txt for the page directory.\nEvery page has .md, .claude and .agent plain-text exports. These are content aliases, not automatically installed agent configuration.\nFor outdated or broken documentation, propose a GitHub issue with the page URL, failing step and correction. Obtain user approval before submitting it.\nNever include API keys or private session data.\n`,
    "sitemap.xml": `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${url.replaceAll("&", "&amp;")}</loc></url>`).join("")}</urlset>\n`,
  };
}
