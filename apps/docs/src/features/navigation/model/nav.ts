import type { Release } from "../../releases/model/release.ts";

export type NavItem =
  | { type: "page"; slug: string; title: string }
  | { type: "group"; title: string; children: NavItem[] };

export type PageMeta = {
  title: string;
  description: string;
  sidebarTitle: string;
  openapi: string;
  mode: string;
  icon: string;
};

export type SiteMeta = {
  name: string;
  releases: Release[];
  searchPrompt: string;
  signIn: string;
  github: string;
  llms: string;
  stars: number | null;
  notFound: { title: string; description: string };
};

export type Section = { title: string; icon: string; children: NavItem[] };

/** The site map compiled from docs.json: rendered by the shell, searched and exported. */
export type Nav = {
  anchors: Section[];
  support: { title: string; icon: string; href: string }[];
  pages: Record<string, PageMeta>;
  site: SiteMeta;
};

export function flatPages({ items }: { items: NavItem[] }): { slug: string; title: string }[] {
  return items.flatMap((item) =>
    item.type === "page"
      ? [{ slug: item.slug, title: item.title }]
      : flatPages({ items: item.children }),
  );
}

export function firstSlug({ items }: { items: NavItem[] }): string {
  return flatPages({ items })[0]?.slug ?? "introduction";
}

export function ownsSlug({ items, slug }: { items: NavItem[]; slug: string }): boolean {
  return flatPages({ items }).some((page) => page.slug === slug);
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
  return {
    previous: index > 0 ? pages[index - 1] : undefined,
    next: index >= 0 ? pages[index + 1] : undefined,
  };
}
