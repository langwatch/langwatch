export const DOCS_ORIGIN = "https://docs.langwatch.ai";

export function canonicalUrl({ slug }: { slug: string }) {
  return `${DOCS_ORIGIN}/${slug === "introduction" ? "" : slug}`;
}

function escapeAttribute(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}

export function pageHead({
  slug,
  title,
  description = "",
}: {
  slug: string;
  title: string;
  description?: string;
}) {
  const url = canonicalUrl({ slug });
  const image = `${DOCS_ORIGIN}/images/coding-agents/optimized/session-detail-1560.webp`;
  const tags = [
    `<title>${escapeAttribute(title)}</title>`,
    `<link rel="canonical" href="${escapeAttribute(url)}">`,
    `<link rel="alternate" type="text/markdown" href="/${slug}.md">`,
    '<link rel="describedby" type="text/plain" href="/llms.txt">',
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
    isPartOf: { "@type": "WebSite", name: "LangWatch documentation", url: `${DOCS_ORIGIN}/` },
  };
  tags.push(
    `<script data-docs-metadata type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`,
  );
  return tags.join("");
}
