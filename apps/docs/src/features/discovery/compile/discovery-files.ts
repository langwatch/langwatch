import { canonicalUrl, docsUrl, publicSlug } from "../../../lib/site-path.ts";
import { flatPages, type NavItem, type Section, sectionId } from "../../navigation/model.ts";
import { agentCard, agentSkillsIndex, skillFile } from "./agent-discovery.ts";
import type { AgentSkill } from "./agent-discovery.ts";
import { INDEX_LINE } from "./markdown-export.ts";

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
  if (!page) throw new Error(`No navigation entry for ${slug}`);
  return `- [${page.title}](${docsUrl({ path: `/${publicSlug({ slug })}.md` })})${page.description ? `: ${page.description}` : ""}`;
}

/** Sections listed in llms.txt one entry per resource, each linking the resource's overview;
    every operation stays in the section's own file. */
export const RESOURCE_LISTED_SECTIONS = new Set(["API Reference"]);

/** A section's own file, holding every one of its pages' Markdown. */
export function sectionFile({ title }: { title: string }) {
  return `llms-full/${sectionId({ title })}.txt`;
}

/** One line per resource group: its overview page and how many pages the section file holds. */
function resourceLines({ nav, items }: { nav: DirectoryNav; items: NavItem[] }) {
  return items.flatMap((item) => {
    if (item.type === "page") return [directoryLine({ nav, slug: item.slug })];
    const slugs = flatPages({ items: item.children })
      .map((page) => page.slug)
      .filter((slug) => Object.hasOwn(nav.pages, slug));
    const [overview] = slugs;
    if (!overview) return [];
    const href = docsUrl({ path: `/${publicSlug({ slug: overview })}.md` });
    return [`- [${item.title}](${href}): ${slugs.length} ${slugs.length === 1 ? "page" : "pages"}`];
  });
}

/** The pages a section lists, in reading order, skipping any an earlier section listed. */
function sectionSlugs({
  nav,
  section,
  listed,
}: {
  nav: DirectoryNav;
  section: Section;
  listed: Set<string>;
}) {
  return flatPages({ items: section.children })
    .map((page) => page.slug)
    .filter((slug) => Object.hasOwn(nav.pages, slug) && !listed.has(slug));
}

/** Every page once, grouped under the site's own sections in reading order; the rest after. */
export function llmsDirectory({ nav }: { nav: DirectoryNav }) {
  const listed = new Set<string>();
  const groups: string[] = [];
  const files: string[] = [];
  for (const section of nav.anchors ?? []) {
    const slugs = sectionSlugs({ nav, section, listed });
    if (slugs.length === 0) continue;
    for (const slug of slugs) listed.add(slug);
    const file = docsUrl({ path: `/${sectionFile({ title: section.title })}` });
    files.push(`- [${section.title}](${file}): ${slugs.length} pages in one file`);
    const lines = RESOURCE_LISTED_SECTIONS.has(section.title)
      ? resourceLines({ nav, items: section.children })
      : slugs.map((slug) => directoryLine({ nav, slug }));
    const note = RESOURCE_LISTED_SECTIONS.has(section.title)
      ? `\n\nOne entry per resource; every operation is in ${file}.`
      : "";
    groups.push(`## ${section.title}${note}\n\n${lines.join("\n")}`);
  }
  const rest = Object.keys(nav.pages).filter((slug) => !listed.has(slug));
  if (rest.length > 0)
    groups.push(
      `## ${groups.length ? "More pages" : "Documentation"}\n\n${rest.map((slug) => directoryLine({ nav, slug })).join("\n")}`,
    );
  const sections = files.length ? `## Sections in one file each\n\n${files.join("\n")}\n\n` : "";
  return `# ${nav.site.name}\n\n> ${DIRECTORY_SUMMARY}\n\n${AGENT_GUIDANCE}\n\n${sections}${groups.join("\n\n")}\n`;
}

const DIRECTORY_SUMMARY =
  "LangWatch is the open-source platform to trace, evaluate, test and optimize LLM apps and AI agents.";

/* Carried over from the llms.txt the current docs publish, so agents keep the same instructions. */
const AGENT_GUIDANCE = [
  "Every page below is plain Markdown. Open the pages relevant to the question rather than answering from this index alone. Each section is also one file, listed next; the complete documentation in one file is at " +
    docsUrl({ path: "/llms-full.txt" }) +
    ", too large to read whole.",
  "For agents: if anything in these docs is wrong, confusing, or fails when you try it, ask your user for permission and run `npx langwatch report --user-approved` to send the problem to the LangWatch team. No login is needed; `npx langwatch report --help` has the details.",
].join("\n\n");

/** A page's Markdown export as it appears in a combined file. */
export type PageExport = { slug: string; markdown: string };

/** Drops each page's pointer to llms.txt: the combined file's own guidance names it once. */
function combined({ nav, exports }: { nav: DirectoryNav; exports: PageExport[] }) {
  const pages = exports.map(({ markdown }) =>
    markdown
      .split("\n")
      .filter((line) => !line.startsWith(INDEX_LINE))
      .join("\n")
      .trim(),
  );
  return `# ${nav.site.name}\n\n> ${DIRECTORY_SUMMARY}\n\n${AGENT_GUIDANCE}\n\n${pages.join("\n\n---\n\n")}\n`;
}

/** Every page's Markdown export in reading order, as one file for agents that read it whole. */
export function llmsFull({ nav, exports }: { nav: DirectoryNav; exports: PageExport[] }) {
  return combined({ nav, exports });
}

/** One file per section, named in llms.txt, each with the section's pages in reading order. */
export function llmsSectionFiles({ nav, exports }: { nav: DirectoryNav; exports: PageExport[] }) {
  const bySlug = new Map(exports.map((page) => [page.slug, page]));
  const listed = new Set<string>();
  const files: Record<string, string> = {};
  for (const section of nav.anchors ?? []) {
    const slugs = sectionSlugs({ nav, section, listed });
    for (const slug of slugs) listed.add(slug);
    const pages = slugs.flatMap((slug) => bySlug.get(slug) ?? []);
    if (pages.length > 0)
      files[sectionFile({ title: section.title })] = combined({ nav, exports: pages });
  }
  return files;
}

/** The AI crawlers robots.txt allows by name; the agent readiness budgets list the same ones. */
export const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
  "Perplexity-User",
  "Applebot",
  "Applebot-Extended",
  "Meta-ExternalAgent",
  "Amazonbot",
  "DuckAssistBot",
  "MistralAI-User",
];

/** The IndexNow key, public by design: served at /docs/indexnow.txt, which the deploy names as
    the key's location when it submits changed pages (tools/docsdeploy). */
export const INDEXNOW_KEY = "1cad103100f30102115cf3d4cb017129";

const CONTENT_SIGNAL = "Content-Signal: ai-train=yes, search=yes, ai-input=yes";

/** The catch-all group, then one group naming every AI crawler, each with the content signal. */
function robots() {
  return [
    "User-agent: *",
    CONTENT_SIGNAL,
    "Allow: /",
    "",
    ...AI_CRAWLERS.map((crawler) => `User-agent: ${crawler}`),
    CONTENT_SIGNAL,
    "Allow: /",
    "",
    `Sitemap: ${docsUrl({ path: "/sitemap.xml" })}`,
    "",
  ].join("\n");
}

/** Crawler and agent discovery files published at the site root, llms.txt included. */
export function discoveryFiles({
  nav,
  lastModified = new Map(),
  skills = [],
}: {
  nav: DirectoryNav;
  lastModified?: ReadonlyMap<string, string>;
  skills?: AgentSkill[];
}): Record<string, string> {
  const entries = Object.keys(nav.pages).map((slug) => {
    const date = lastModified.get(slug);
    const loc = `<loc>${canonicalUrl({ slug }).replaceAll("&", "&amp;")}</loc>`;
    return `<url>${loc}${date ? `<lastmod>${date}</lastmod>` : ""}</url>`;
  });
  return {
    ...Object.fromEntries(skills.map((skill) => [skillFile({ name: skill.name }), skill.contents])),
    ".well-known/agent-skills/index.json": `${JSON.stringify(agentSkillsIndex({ skills }))}\n`,
    ".well-known/agent-card.json": `${JSON.stringify(agentCard({ skills, description: DIRECTORY_SUMMARY }))}\n`,
    "llms.txt": llmsDirectory({ nav }),
    "robots.txt": robots(),
    "indexnow.txt": `${INDEXNOW_KEY}\n`,
    "humans.txt": `Reasoning Engine B.V.\nBuilt in Amsterdam.\nSource: https://github.com/langwatch/langwatch\nDocumentation contributions: https://github.com/langwatch/langwatch/issues\n`,
    "agents.txt": `# LangWatch documentation for agents\n\nStart with ${docsUrl({ path: "/llms.txt" })} for the page directory.\nEvery page has .md, .claude and .agent plain-text exports. These are content aliases, not automatically installed agent configuration.\nllms.txt also links one file per section; the whole documentation is one file at ${docsUrl({ path: "/llms-full.txt" })}.\nFor outdated or broken documentation, ask your user for permission, then run "npx langwatch report --user-approved" or open a GitHub issue with the page URL, failing step and correction.\nNever include API keys or private session data.\n`,
    "sitemap.xml": `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join("")}</urlset>\n`,
  };
}
