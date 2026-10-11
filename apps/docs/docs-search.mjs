function trailOf({ items, slug }) {
  for (const item of items) {
    if (item.type === "page" && item.slug === slug) return [];
    if (item.type === "group") {
      const trail = trailOf({ items: item.children, slug });
      if (trail) return [item.title, ...trail];
    }
  }
  return null;
}
export function searchTrail({ nav, slug }) {
  for (const anchor of nav.anchors) {
    const trail = trailOf({ items: anchor.children, slug });
    if (trail) return { section: anchor.title, trail: [anchor.title, ...trail].join(" › ") };
  }
  return { section: "", trail: "" };
}
export function bodyText({ html }) {
  const article =
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/)?.[1] ??
    html.match(/<main\b[^>]*\bid="content"[^>]*>([\s\S]*?)<\/main>/)?.[1] ??
    "";
  return article
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchEntry({ nav, slug, html, headings }) {
  const meta = nav.pages[slug];
  return {
    slug,
    ...(meta.openapi ? { method: meta.openapi.split(/\s+/)[0].toUpperCase() } : {}),
    title: meta.title,
    description: meta.description,
    ...searchTrail({ nav, slug }),
    body: bodyText({ html }),
    headings: headings.map(({ id, text }) => ({ id, text })),
  };
}
