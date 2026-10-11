import { canonicalUrl, DOCS_ORIGIN as origin } from "./page-head.ts";

/** The slice of the navigation the directory files list. */
type DirectoryNav = {
  site: { name: string };
  pages: Record<string, { title: string; description: string }>;
};

/** Every page is exported as identical Markdown under each of these extensions. */
export const PAGE_EXPORT_EXTENSIONS = ["md", "claude", "agent"] as const;

/** `index.<ext>` exports map to the introduction. */
export function exportSlug({ pathname }: { pathname: string }) {
  const raw = pathname.slice(1).replace(/\.(md|claude|agent)$/, "");
  return raw === "index" ? "introduction" : raw;
}

export function llmsDirectory({ nav }: { nav: DirectoryNav }) {
  const lines = Object.entries(nav.pages).map(
    ([slug, page]) =>
      `- [${page.title}](${origin}/${slug}.md)${page.description ? `: ${page.description}` : ""}`,
  );
  return `# ${nav.site.name}\n\n## Documentation\n\n${lines.join("\n")}\n`;
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
