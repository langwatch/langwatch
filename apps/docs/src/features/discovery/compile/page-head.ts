import { isProduction } from "../../../config.ts";
import { canonicalUrl, docsUrl, sitePath } from "../../../lib/site-path.ts";
import { docsRoot } from "../../../paths.ts";
import type { Operation } from "../../api-reference/model/operation.ts";
import { pageDates, readDocsConfig } from "../../navigation/compile/nav.ts";
import {
  firstSlug,
  ownsSlug,
  type Organization,
  type Section,
} from "../../navigation/model/nav.ts";

/**
 * Where the web fonts live: dev serves them at this path, a build renames each to Vite's hashed
 * file.
 */
export const FONT_SOURCE = "/src/app/fonts";

/* The body font and the title font paint above the fold on every page; the rest load on demand. */
const ABOVE_THE_FOLD_FONTS = [
  `${FONT_SOURCE}/Inter-Variable-latin.woff2`,
  `${FONT_SOURCE}/Sentient-Regular.woff2`,
];

/** The social card: shared links fetch it by this address, so it keeps its authored name. */
export const SOCIAL_IMAGE = "/images/coding-agents/optimized/session-detail-1560.webp";

/* Absolute links to the agent discovery files, the same on every page. */
const DISCOVERY_LINKS = [
  { rel: "llms-txt", path: "/llms.txt" },
  { rel: "llms-full-txt", path: "/llms-full.txt" },
  { rel: "agent-card", path: "/.well-known/agent-card.json" },
  { rel: "agent-skills", path: "/.well-known/agent-skills/index.json" },
];

/** The docs.json settings a page head reads. */
export type HeadSettings = {
  description: string;
  organization: Organization | null;
  tagManager: string;
  /** Last commit dates by slug; empty unless docs.json shows timestamps. */
  dates: ReadonlyMap<string, string>;
};

/** Head settings from the authored docs.json, read per call so development sees edits. */
export function headSettings({ root = docsRoot }: { root?: string } = {}): HeadSettings {
  const config = readDocsConfig({ docsRoot: root });
  const organization = config.seo?.organization;
  return {
    description: config.description ?? "",
    organization: organization ? { logo: "", sameAs: [], ...organization } : null,
    tagManager: config.integrations?.gtm?.tagId ?? "",
    dates: config.metadata?.timestamp ? pageDates({ docsRoot: root }) : new Map(),
  };
}

function escapeAttribute(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Longest meta description a search result shows without cutting it off itself. */
export const MAX_DESCRIPTION_LENGTH = 160;
/** Shortest meta description a search engine keeps instead of writing its own snippet. */
export const MIN_DESCRIPTION_LENGTH = 50;
const MIN_SENTENCE_LENGTH = MIN_DESCRIPTION_LENGTH;

/** The authored description, else the operation's, else one naming the endpoint. */
export function pageDescription({
  title,
  description,
  operation,
}: {
  title: string;
  description?: string;
  operation: Pick<Operation, "method" | "path" | "description"> | null;
}) {
  if (description) return description;
  if (!operation) return "";
  return (
    operation.description ||
    `${title}: ${operation.method} ${operation.path} in the LangWatch REST API.`
  );
}

/**
 * The page description for the meta tags: on an API page, one too short for a search snippet
 * ("Delete a group") is followed by the endpoint it describes.
 */
export function headDescription(page: Parameters<typeof pageDescription>[0]) {
  const text = pageDescription(page);
  const { operation } = page;
  if (!operation || text.length >= MIN_DESCRIPTION_LENGTH) return text;
  return `${text.replace(/\.$/, "")} with ${operation.method} ${operation.path} in the LangWatch REST API.`;
}

/** The suffix Mintlify gives every page title, kept so the migration does not change titles. */
export const TITLE_SUFFIX = " - LangWatch";

/** The `<title>` text for a page: "Quick Start - LangWatch". */
export function documentTitle({ title }: { title: string }) {
  return `${title}${TITLE_SUFFIX}`;
}

/**
 * A description of at most 160 characters. A longer one is cut after its last full sentence
 * that fits, else at the last word that fits; nothing is added and a word is never split.
 */
export function trimDescription({
  text,
  max = MAX_DESCRIPTION_LENGTH,
}: {
  text: string;
  max?: number;
}) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const window = flat.slice(0, max + 1);
  let sentenceEnd = -1;
  for (const match of window.matchAll(/[.!?](?=\s|$)/g)) sentenceEnd = match.index + 1;
  if (sentenceEnd >= MIN_SENTENCE_LENGTH && sentenceEnd <= max) return flat.slice(0, sentenceEnd);
  const wordEnd = window.lastIndexOf(" ");
  const cut = wordEnd > 0 ? flat.slice(0, wordEnd) : flat.slice(0, max);
  return cut.replace(/[\s,;:\-\u2013\u2014(]+$/, "");
}

/** A crumb is a page a reader can open: its title and slug. */
export type Crumb = { title: string; slug: string };

/**
 * The trail the site itself shows: the docs home, the section's landing page (the page its
 * tab opens), then the page. Group titles have no page of their own, so they are left out.
 */
export function breadcrumbTrail({
  sections,
  slug,
  title,
}: {
  sections: Section[];
  slug: string;
  title: string;
}): Crumb[] {
  const section = sections.find((candidate) => ownsSlug({ items: candidate.children, slug }));
  const landing = section ? firstSlug({ items: section.children }) : undefined;
  const trail: Crumb[] = [{ title: "Documentation", slug: "introduction" }];
  if (section && landing && landing !== slug && landing !== "introduction")
    trail.push({ title: section.title, slug: landing });
  if (slug !== "introduction") trail.push({ title, slug });
  return trail;
}

function breadcrumbData({ trail }: { trail: Crumb[] }) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.title,
      item: canonicalUrl({ slug: crumb.slug }),
    })),
  };
}

function jsonLd({ data }: { data: unknown }) {
  return `<script data-docs-metadata type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;
}

function organizationData({ organization }: { organization: Organization }) {
  return {
    "@type": "Organization",
    name: organization.name,
    url: organization.url,
    ...(organization.logo ? { logo: { "@type": "ImageObject", url: organization.logo } } : {}),
    ...(organization.sameAs.length ? { sameAs: organization.sameAs } : {}),
  };
}

/** The organization's X account, from the profile it lists, as "@handle". */
function twitterHandle({ organization }: { organization: Organization | null }) {
  const profile = organization?.sameAs.find((link) =>
    /^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]+\/?$/.test(link),
  );
  return profile ? `@${profile.replace(/\/$/, "").split("/").at(-1)}` : null;
}

/** The page's own structured data: a technical article, or the docs home as a web page. */
function pageData({
  url,
  title,
  description,
  modified,
  image,
  article,
  settings,
}: {
  url: string;
  title: string;
  description: string;
  modified: string | undefined;
  image: string;
  article: boolean;
  settings: HeadSettings;
}) {
  const publisher = settings.organization
    ? organizationData({ organization: settings.organization })
    : null;
  return {
    "@context": "https://schema.org",
    "@type": article ? "TechArticle" : "WebPage",
    "@id": url,
    url,
    name: title,
    ...(article ? { headline: title, mainEntityOfPage: url } : {}),
    ...(description ? { description } : {}),
    inLanguage: "en",
    image,
    ...(modified ? { dateModified: modified } : {}),
    ...(article && publisher ? { author: publisher, publisher } : {}),
    isPartOf: {
      "@type": "WebSite",
      name: "LangWatch documentation",
      url: docsUrl({ path: "/introduction" }),
      ...(publisher ? { publisher } : {}),
    },
  };
}

export function pageHead({
  slug,
  title,
  description: authored = "",
  trail = [],
  settings = headSettings(),
  production = isProduction,
}: {
  slug: string;
  title: string;
  description?: string;
  trail?: Crumb[];
  settings?: HeadSettings;
  /** Production pages name the tag manager container; development pages never do. */
  production?: boolean;
}) {
  const url = canonicalUrl({ slug });
  const description = trimDescription({ text: authored || settings.description });
  const modified = settings.dates.get(slug);
  const image = docsUrl({ path: SOCIAL_IMAGE });
  const article = slug !== "introduction";
  const handle = twitterHandle({ organization: settings.organization });
  const tags = [
    `<title>${escapeAttribute(documentTitle({ title }))}</title>`,
    `<link rel="canonical" href="${escapeAttribute(url)}">`,
    `<link rel="alternate" type="text/markdown" href="${sitePath({ path: `/${slug}.md` })}">`,
    `<link rel="describedby" type="text/plain" href="${sitePath({ path: "/llms.txt" })}">`,
    ...DISCOVERY_LINKS.map(({ rel, path }) => `<link rel="${rel}" href="${docsUrl({ path })}">`),
    ...ABOVE_THE_FOLD_FONTS.map(
      (path) =>
        `<link rel="preload" href="${sitePath({ path })}" as="font" type="font/woff2" crossorigin>`,
    ),
    `<meta property="og:type" content="${article ? "article" : "website"}">`,
    ...(article && modified
      ? [`<meta property="article:modified_time" content="${escapeAttribute(modified)}">`]
      : []),
    '<meta property="og:site_name" content="LangWatch documentation">',
    `<meta property="og:title" content="${escapeAttribute(documentTitle({ title }))}">`,
    `<meta property="og:url" content="${escapeAttribute(url)}">`,
    `<meta property="og:image" content="${image}">`,
    '<meta property="og:image:alt" content="A coding-agent session in LangWatch">',
    '<meta name="twitter:card" content="summary_large_image">',
    ...(handle ? [`<meta name="twitter:site" content="${escapeAttribute(handle)}">`] : []),
    `<meta name="twitter:title" content="${escapeAttribute(documentTitle({ title }))}">`,
    `<meta name="twitter:image" content="${image}">`,
  ];
  if (description) {
    for (const attribute of [
      'name="description"',
      'property="og:description"',
      'name="twitter:description"',
    ]) {
      tags.push(`<meta ${attribute} content="${escapeAttribute(description)}">`);
    }
  }
  const data = pageData({ url, title, description, modified, image, article, settings });
  tags.push(jsonLd({ data }));
  if (production && settings.tagManager)
    tags.push(`<meta name="docs-gtm" content="${escapeAttribute(settings.tagManager)}">`);
  if (trail.length > 1) tags.push(jsonLd({ data: breadcrumbData({ trail }) }));
  return tags.join("");
}
