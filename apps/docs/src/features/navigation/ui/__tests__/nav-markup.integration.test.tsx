import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { NavItem } from "../../model/nav.ts";
import { MobileNav } from "../mobile-nav.tsx";
import { NavTree } from "../nav-tree.tsx";

vi.mock("virtual:docs-nav", () => ({
  default: {
    pages: {},
    anchors: [],
    support: [],
    site: { llms: "/llms.txt", signIn: "https://app.langwatch.ai" },
  },
}));

/* Markup without the design system's inline style blocks. */
const render = (node: ReactNode) =>
  renderToStaticMarkup(<DesignSystemTestProvider>{node}</DesignSystemTestProvider>).replace(
    /<style\b[^>]*>[\s\S]*?<\/style>/g,
    "",
  );

const items: NavItem[] = [
  { type: "page", slug: "introduction", title: "Introduction" },
  {
    type: "group",
    title: "Evaluations",
    children: [
      { type: "page", slug: "evaluations/overview", title: "Overview" },
      { type: "page", slug: "evaluations/online", title: "Online" },
    ],
  },
  {
    type: "group",
    title: "Datasets",
    children: [
      { type: "page", slug: "datasets/overview", title: "Overview" },
      { type: "page", slug: "datasets/upload", title: "Upload" },
    ],
  },
] as NavItem[];

describe("when a page lists collapsible navigation groups", () => {
  const html = render(
    <NavTree items={items} current="evaluations/online" section="Platform" id="page-tree" />,
  );
  const toggles = html.match(/<button[^>]*data-docs-group[\s\S]*?<\/button>/g) ?? [];

  /** @scenario "Draw navigation chevrons from shared styles" */
  it("gives every group toggle a styled chevron and no inline icon", () => {
    expect(toggles).toHaveLength(2);
    for (const toggle of toggles) {
      expect(toggle).not.toContain("<svg");
      expect(toggle).toContain('<span class="docs-nav-chevron" aria-hidden="true"></span>');
    }
  });

  /** @scenario "Draw navigation chevrons from shared styles" */
  it("marks only the group holding the current page as open", () => {
    expect(toggles[0]).toContain('aria-expanded="true"');
    expect(toggles[1]).toContain('aria-expanded="false"');
  });

  /** @scenario "Draw navigation chevrons from shared styles" */
  it("lists pages in plain list items styled by the shared stylesheet", () => {
    expect(html).toMatch(/<li><a href="[^"]*introduction"/);
    expect(html).toContain("<ul><li>");
  });
});

describe("when a page renders the mobile navigation drawer", () => {
  const html = render(<MobileNav open={false} onClose={() => {}} active={undefined} slug="x" />);

  /** @scenario "Open the mobile navigation from the page's one navigation tree" */
  it("ships the drawer without a second copy of the page tree", () => {
    expect(html).toContain('id="docs-mobile-nav"');
    expect(html).toContain("data-docs-mobile-body");
    expect(html).not.toContain("Page navigation");
    expect(html).not.toContain("Documentation sections");
  });
});
