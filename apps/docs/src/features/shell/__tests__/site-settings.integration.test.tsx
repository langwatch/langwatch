import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseInline } from "../../navigation/model/inline.ts";
import { CONTEXTUAL_OPTIONS } from "../../navigation/model/nav.ts";
import { SiteAnnouncement } from "../ui/announcement.tsx";
import { InlineContent } from "../ui/inline-content.tsx";
import { LastUpdated } from "../ui/last-updated.tsx";
import { PageHeader } from "../ui/page-header.tsx";
import { editorInstallHref, LANGWATCH_MCP_URL, PageMenu } from "../ui/page-menu.tsx";

/* Markup without the design system's inline style blocks. */
const render = (node: ReactNode) =>
  renderToStaticMarkup(<DesignSystemTestProvider>{node}</DesignSystemTestProvider>).replace(
    /<style\b[^>]*>[\s\S]*?<\/style>/g,
    "",
  );

describe("when a page has a last commit date", () => {
  /** @scenario "Show when a page was last updated" */
  it("shows the date in British form with a machine-readable time", () => {
    const html = render(<LastUpdated date="2026-10-12T08:12:32+00:00" />);
    expect(html).toContain("Last updated");
    expect(html).toMatch(/<time datetime="2026-10-12T08:12:32.000Z">12 October 2026<\/time>/i);
  });

  /** @scenario "Show when a page was last updated" */
  it("shows nothing for an unknown or invalid date", () => {
    expect(render(<LastUpdated date="" />)).toBe("");
    expect(render(<LastUpdated date="not a date" />)).toBe("");
  });
});

describe("when docs.json has a banner", () => {
  const content = parseInline({ source: "**[Skills](/skills/directory):** Ask your assistant." });

  /** @scenario "Show the authored announcement beside the release update" */
  it("renders its links and emphasis with a dismiss button keyed by content", () => {
    const html = render(
      <SiteAnnouncement announcement={{ id: "announcement:abc", content, dismissible: true }} />,
    );
    expect(html).toContain('aria-label="Announcement"');
    expect(html).toContain('data-docs-banner="announcement:abc"');
    expect(html).toMatch(/<strong><a[^>]+href="\/skills\/directory"[^>]*>Skills<\/a>:<\/strong>/);
    expect(html).toContain("data-docs-dismiss");
  });

  /** @scenario "Show the authored announcement beside the release update" */
  it("has no dismiss button when not dismissible and renders nothing without a banner", () => {
    const html = render(
      <SiteAnnouncement announcement={{ id: "announcement:abc", content, dismissible: false }} />,
    );
    expect(html).not.toContain("data-docs-dismiss");
    expect(render(<SiteAnnouncement announcement={null} />)).toBe("");
  });
});

describe("when the not found copy has links", () => {
  /** @scenario "Explain a missing page with the authored copy" */
  it("renders them as working site links", () => {
    const html = render(
      <InlineContent
        nodes={parseInline({ source: "Start from the [introduction](/introduction)." })}
      />,
    );
    expect(html).toMatch(/Start from the <a[^>]+href="\/introduction"[^>]*>introduction<\/a>\./);
  });
});

describe("when a page is tagged", () => {
  /** @scenario "Mark deprecated pages" */
  it("shows the tag beside the breadcrumb", () => {
    const html = render(
      <PageHeader slug="old" title="Old" description="" breadcrumb={["API"]} tag="Deprecated" />,
    );
    expect(html).toMatch(/data-docs-page-tag=""[^>]*>Deprecated</);
    expect(
      render(<PageHeader slug="new" title="New" description="" breadcrumb={["API"]} />),
    ).not.toContain("data-docs-page-tag");
  });
});

describe("when docs.json lists contextual options", () => {
  /** @scenario "Offer the configured page actions" */
  it("hands the configured actions to the page menu and drops the copy button without copy", () => {
    const withCopy = render(
      <PageHeader
        slug="guide"
        title="Guide"
        description=""
        breadcrumb={[]}
        actions={["copy", "view", "mcp"]}
      />,
    );
    expect(withCopy).toContain('data-actions="copy view mcp"');
    expect(withCopy).toContain("data-docs-page-copy");
    const viewOnly = render(
      <PageHeader slug="guide" title="Guide" description="" breadcrumb={[]} actions={["view"]} />,
    );
    expect(viewOnly).not.toContain("data-docs-page-copy");
    expect(
      render(<PageHeader slug="guide" title="Guide" description="" breadcrumb={[]} />),
    ).not.toContain("data-docs-page-menu");
  });

  /** @scenario "Offer the configured page actions" */
  it("offers exactly the configured actions in order", () => {
    const html = render(<PageMenu slug="guide" actions={["mcp", "claude", "cursor"]} />);
    const titles = [
      ...html.matchAll(
        /(Copy MCP server URL|Open in Claude|Connect to Cursor|Open in ChatGPT|View as Markdown|Connect to VS Code)/g,
      ),
    ].map((match) => match[1]);
    expect(titles).toEqual(["Copy MCP server URL", "Open in Claude", "Connect to Cursor"]);
    const all = render(<PageMenu slug="guide" actions={[...CONTEXTUAL_OPTIONS]} />);
    for (const title of ["Copy page", "View as Markdown", "Open in ChatGPT", "Connect to VS Code"])
      expect(all).toContain(title);
  });

  /** @scenario "Offer the configured page actions" */
  it("connects the editors to the LangWatch MCP server", () => {
    const cursor = new URL(editorInstallHref({ editor: "cursor" }));
    expect(cursor.protocol).toBe("cursor:");
    expect(JSON.parse(atob(cursor.searchParams.get("config") ?? ""))).toEqual({
      url: LANGWATCH_MCP_URL,
    });
    const vscode = editorInstallHref({ editor: "vscode" });
    expect(vscode.startsWith("vscode:mcp/install?")).toBe(true);
    expect(JSON.parse(decodeURIComponent(vscode.split("?")[1] ?? ""))).toEqual({
      name: "langwatch",
      type: "http",
      url: "https://app.langwatch.ai/mcp",
    });
  });
});
