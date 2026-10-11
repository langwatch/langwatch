import nav from "virtual:docs-nav";
import type { NavItem } from "virtual:docs-nav";

export type { NavItem };
export type Section = (typeof nav.anchors)[number];

export const sections = nav.anchors;
export const site = nav.site;

export function flatPages({ items }: { items: NavItem[] }): { slug: string; title: string }[] {
  return items.flatMap((item) => (item.type === "page" ? [{ slug: item.slug, title: item.title }] : flatPages({ items: item.children })));
}

export function firstSlug({ items }: { items: NavItem[] }): string {
  return flatPages({ items })[0]?.slug ?? "introduction";
}

export function ownsSlug({ items, slug }: { items: NavItem[]; slug: string }): boolean {
  return flatPages({ items }).some((page) => page.slug === slug);
}

/** A direct URL uses the first section, in config order, whose tree contains the page. */
export function sectionOf({ slug }: { slug: string }): Section | undefined {
  return sections.find((section) => ownsSlug({ items: section.children, slug }));
}

/** Group titles from the section root down to the page. */
export function trailOf({ items, slug }: { items: NavItem[]; slug: string }): string[] | null {
  for (const item of items) {
    if (item.type === "page" && item.slug === slug) return [];
    if (item.type === "group") {
      const inner = trailOf({ items: item.children, slug });
      if (inner) return [item.title, ...inner];
    }
  }
  return null;
}

export function neighbours({ section, slug }: { section: Section | undefined; slug: string }) {
  const pages = section ? flatPages({ items: section.children }) : [];
  const index = pages.findIndex((page) => page.slug === slug);
  return { previous: index > 0 ? pages[index - 1] : undefined, next: index >= 0 ? pages[index + 1] : undefined };
}
