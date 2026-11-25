import nav from "virtual:docs-nav";

import { ownsSlug, type Section } from "../model/nav.ts";

export const sections = nav.anchors;
export const site = nav.site;
export const support = nav.support;
export const pages = nav.pages;

/** A direct URL uses the first section, in config order, whose tree contains the page. */
export function sectionOf({ slug }: { slug: string }): Section | undefined {
  return sections.find((section) => ownsSlug({ items: section.children, slug }));
}
