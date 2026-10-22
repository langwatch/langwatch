import { canonicalUrl, docsUrl, sitePath } from "../../../lib/site-path.ts";
import type { Operation } from "../../api-reference/model/operation.ts";
import { firstSlug, ownsSlug, type Section } from "../../navigation/model/nav.ts";

function escapeAttribute(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}

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

export function pageHead({
  slug,
  title,
  description = "",
  trail = [],
}: {
  slug: string;
  title: string;
  description?: string;
  trail?: Crumb[];
}) {
  const url = canonicalUrl({ slug });
  const image = docsUrl({ path: "/images/coding-agents/optimized/session-detail-1560.webp" });
  const tags = [
    `<title>${escapeAttribute(title)}</title>`,
    `<link rel="canonical" href="${escapeAttribute(url)}">`,
    `<link rel="alternate" type="text/markdown" href="${sitePath({ path: `/${slug}.md` })}">`,
    `<link rel="describedby" type="text/plain" href="${sitePath({ path: "/llms.txt" })}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="LangWatch documentation">',
    `<meta property="og:title" content="${escapeAttribute(title)}">`,
    `<meta property="og:url" content="${escapeAttribute(url)}">`,
    `<meta property="og:image" content="${image}">`,
    '<meta property="og:image:alt" content="A coding-agent session in LangWatch">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeAttribute(title)}">`,
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
  const data = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": url,
    url,
    name: title,
    ...(description ? { description } : {}),
    isPartOf: {
      "@type": "WebSite",
      name: "LangWatch documentation",
      url: docsUrl({ path: "/introduction" }),
    },
  };
  tags.push(jsonLd({ data }));
  if (trail.length > 1) tags.push(jsonLd({ data: breadcrumbData({ trail }) }));
  return tags.join("");
}
