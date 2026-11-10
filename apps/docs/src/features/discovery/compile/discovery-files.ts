import { canonicalUrl, docsUrl, publicSlug } from "../../../lib/site-path.ts";
import { flatPages, type NavItem, type Section, sectionId } from "../../navigation/model.ts";
import { agentCard, agentSkillsIndex, skillFile, skillUrl } from "./agent-discovery.ts";
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

/** A combined file past this many characters (about 100k tokens) is split by its groups. */
export const LLMS_FILE_BUDGET = 400_000;

/** One combined file: where it is published, what llms.txt calls it and its pages in order. */
export type LlmsFile = { file: string; title: string; slugs: string[] };

type FileScope = {
  nav: DirectoryNav;
  sizes: ReadonlyMap<string, number>;
  budget: number;
  /** Pages an earlier section already holds. */
  listed: ReadonlySet<string>;
};

function scopeSlugs({ scope, items }: { scope: FileScope; items: NavItem[] }) {
  return flatPages({ items })
    .map((page) => page.slug)
    .filter((slug) => Object.hasOwn(scope.nav.pages, slug) && !scope.listed.has(slug));
}

/** One file for the items; past the budget, one per group (split again while still over budget)
    after one for the pages outside any group. */
function filesFor({
  scope,
  items,
  path,
  title,
}: {
  scope: FileScope;
  items: NavItem[];
  path: string;
  title: string;
}): LlmsFile[] {
  const slugs = scopeSlugs({ scope, items });
  const size = slugs.reduce((sum, slug) => sum + (scope.sizes.get(slug) ?? 0), 0);
  const groups = items.flatMap((item) => (item.type === "group" ? [item] : []));
  if (size <= scope.budget || groups.length === 0)
    return slugs.length > 0 ? [{ file: `llms-full/${path}.txt`, title, slugs }] : [];
  const loose = items.filter((item) => item.type === "page");
  return [
    ...filesFor({ scope, items: loose, path, title }),
    ...groups.flatMap((group) =>
      filesFor({
        scope,
        items: group.children,
        path: `${path}/${sectionId({ title: group.title })}`,
        title: `${title}: ${group.title}`,
      }),
    ),
  ];
}

/** Each section's pages and the combined files that hold them, in reading order. */
function llmsFilePlan({
  nav,
  sizes = new Map(),
  budget = LLMS_FILE_BUDGET,
}: {
  nav: DirectoryNav;
  sizes?: ReadonlyMap<string, number>;
  budget?: number;
}) {
  const listed = new Set<string>();
  return (nav.anchors ?? []).map((section) => {
    const scope = { nav, sizes, budget, listed: new Set(listed) };
    const slugs = scopeSlugs({ scope, items: section.children });
    for (const slug of slugs) listed.add(slug);
    const files = filesFor({
      scope,
      items: section.children,
      path: sectionId({ title: section.title }),
      title: section.title,
    });
    return { section, slugs, files };
  });
}

/** Each page's Markdown size, which decides where a combined file is split. */
export function exportSizes({ exports }: { exports: PageExport[] }) {
  return new Map(exports.map((page) => [page.slug, page.markdown.length]));
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

function fileLine({ file }: { file: LlmsFile }) {
  const pages = `${file.slugs.length} ${file.slugs.length === 1 ? "page" : "pages"}`;
  return `- [${file.title}](${docsUrl({ path: `/${file.file}` })}): ${pages} in one file`;
}

/** A section's heading and its entries: one per page, or one per resource in the API reference. */
function sectionDirectory({
  nav,
  section,
  slugs,
  files,
}: {
  nav: DirectoryNav;
  section: Section;
  slugs: string[];
  files: LlmsFile[];
}) {
  if (!RESOURCE_LISTED_SECTIONS.has(section.title)) {
    const lines = slugs.map((slug) => directoryLine({ nav, slug }));
    return `## ${section.title}\n\n${lines.join("\n")}`;
  }
  const [only] = files;
  const where =
    files.length === 1 && only
      ? docsUrl({ path: `/${only.file}` })
      : "its resource's file, listed above";
  const lines = resourceLines({ nav, items: section.children });
  return `## ${section.title}\n\nOne entry per resource; every operation is in ${where}.\n\n${lines.join("\n")}`;
}

/** Every page once, grouped under the site's own sections in reading order; the rest after.
    `sizes` (each page's Markdown length) decides which section files are split by group. */
export function llmsDirectory({
  nav,
  sizes,
  budget,
}: {
  nav: DirectoryNav;
  sizes?: ReadonlyMap<string, number>;
  budget?: number;
}) {
  const listed = new Set<string>();
  const groups: string[] = [];
  const files: string[] = [];
  for (const { section, slugs, files: sectionFiles } of llmsFilePlan({ nav, sizes, budget })) {
    if (slugs.length === 0) continue;
    for (const slug of slugs) listed.add(slug);
    files.push(...sectionFiles.map((file) => fileLine({ file })));
    groups.push(sectionDirectory({ nav, section, slugs, files: sectionFiles }));
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

/** One file per section, named in llms.txt, each with the section's pages in reading order; a
    section over the budget is one file per group instead. */
export function llmsSectionFiles({
  nav,
  exports,
  budget,
}: {
  nav: DirectoryNav;
  exports: PageExport[];
  budget?: number;
}) {
  const bySlug = new Map(exports.map((page) => [page.slug, page]));
  const files: Record<string, string> = {};
  const plan = llmsFilePlan({ nav, sizes: exportSizes({ exports }), budget });
  for (const { file, slugs } of plan.flatMap((entry) => entry.files)) {
    const pages = slugs.flatMap((slug) => bySlug.get(slug) ?? []);
    if (pages.length > 0) files[file] = combined({ nav, exports: pages });
  }
  return files;
}

/** The docs-wide skill at /skill.md, an address agents learned from the previous docs host:
    what LangWatch is, where the Markdown lives and which installable skills the docs publish. */
export function docsSkill({ skills }: { skills: AgentSkill[] }) {
  const listed = skills.map(
    (skill) => `- [${skill.name}](${skillUrl({ name: skill.name })}): ${skill.description}`,
  );
  return [
    "---",
    "name: langwatch",
    "description: Use when building, testing or monitoring LLM applications and AI agents with LangWatch: tracing, agent simulations, evaluations, prompt management and the AI Gateway. Read the LangWatch documentation as Markdown before answering.",
    "---",
    "",
    "# LangWatch documentation",
    "",
    DIRECTORY_SUMMARY,
    "",
    "## Reading the docs",
    "",
    `- ${docsUrl({ path: "/llms.txt" })} lists every page with a one-line description, and the one file per section.`,
    "- Every page has a Markdown twin: add `.md` to its address, or ask for it with `Accept: text/markdown`.",
    `- ${docsUrl({ path: "/llms-full.txt" })} is the whole documentation in one file, too large to read whole.`,
    "",
    ...(listed.length > 0 ? ["## Installable skills", "", ...listed, ""] : []),
    "## Reporting a problem",
    "",
    "If anything in these docs is wrong, confusing, or fails when you try it, ask your user for permission and run `npx langwatch report --user-approved`.",
    "",
  ].join("\n");
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
  sizes,
}: {
  nav: DirectoryNav;
  lastModified?: ReadonlyMap<string, string>;
  skills?: AgentSkill[];
  /** Each page's Markdown length, so llms.txt names the section files the build splits. */
  sizes?: ReadonlyMap<string, number>;
}): Record<string, string> {
  const entries = Object.keys(nav.pages).map((slug) => {
    const date = lastModified.get(slug);
    const loc = `<loc>${canonicalUrl({ slug }).replaceAll("&", "&amp;")}</loc>`;
    return `<url>${loc}${date ? `<lastmod>${date}</lastmod>` : ""}</url>`;
  });
  const directory = llmsDirectory({ nav, sizes });
  return {
    ...Object.fromEntries(skills.map((skill) => [skillFile({ name: skill.name }), skill.contents])),
    ".well-known/agent-skills/index.json": `${JSON.stringify(agentSkillsIndex({ skills }))}\n`,
    ".well-known/agent-card.json": `${JSON.stringify(agentCard({ skills, description: DIRECTORY_SUMMARY }))}\n`,
    "llms.txt": directory,
    /* The previous docs host answered here too, and agents and link checkers kept the address. */
    ".well-known/llms.txt": directory,
    "skill.md": docsSkill({ skills }),
    "robots.txt": robots(),
    "indexnow.txt": `${INDEXNOW_KEY}\n`,
    "humans.txt": `Reasoning Engine B.V.\nBuilt in Amsterdam.\nSource: https://github.com/langwatch/langwatch\nDocumentation contributions: https://github.com/langwatch/langwatch/issues\n`,
    "agents.txt": `# LangWatch documentation for agents\n\nStart with ${docsUrl({ path: "/llms.txt" })} for the page directory.\nEvery page has .md, .claude and .agent plain-text exports. These are content aliases, not automatically installed agent configuration.\nllms.txt also links one file per section; the whole documentation is one file at ${docsUrl({ path: "/llms-full.txt" })}.\nFor outdated or broken documentation, ask your user for permission, then run "npx langwatch report --user-approved" or open a GitHub issue with the page URL, failing step and correction.\nNever include API keys or private session data.\n`,
    "sitemap.xml": `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join("")}</urlset>\n`,
  };
}
