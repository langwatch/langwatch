import { canonicalUrl, DOCS_ORIGIN as origin } from "./docs-metadata.mjs";
export const PAGE_EXPORT_EXTENSIONS = ["md", "claude", "agent"];

export function discoveryFiles({ nav }) {
  const urls = Object.keys(nav.pages).map((slug) => canonicalUrl({ slug }));
  return {
    "robots.txt": `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
    "humans.txt": `LangWatch B.V.\nBuilt in Amsterdam.\nSource: https://github.com/langwatch/langwatch\nDocumentation contributions: https://github.com/langwatch/langwatch/issues\n`,
    "agents.txt": `# LangWatch documentation for agents\n\nStart with ${origin}/llms.txt for the page directory.\nEvery page has .md, .claude and .agent plain-text exports. These are content aliases, not automatically installed agent configuration.\nFor outdated or broken documentation, propose a GitHub issue with the page URL, failing step and correction. Obtain user approval before submitting it.\nNever include API keys or private session data.\n`,
    "sitemap.xml": `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${url.replaceAll("&", "&amp;")}</loc></url>`).join("")}</urlset>\n`,
  };
}
