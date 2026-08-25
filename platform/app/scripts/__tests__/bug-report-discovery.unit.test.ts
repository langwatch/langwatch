import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every agent access point carries the report notice: these tests pin the
 * generated llms files, the docs entry pages, and the support guide so a
 * regeneration or docs edit cannot silently drop the invitation.
 * Corresponds to specs/support/agent-report-discovery.feature.
 */
const REPO_ROOT = join(__dirname, "../../../..");
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

describe("agent report discovery notices", () => {
  describe("given the generated llms files", () => {
    /** @scenario "llms.txt carries the report notice" */
    it("keeps the notice at the top of llms.txt", () => {
      const head = read("docs/llms.txt").slice(0, 1200);
      expect(head).toContain("For agents:");
      expect(head).toContain("npx langwatch report --user-approved");
    });

    /** @scenario "The full docs dump carries the report notice" */
    it("keeps the notice at the top of llms-full.txt", () => {
      const head = read("docs/llms-full.txt").slice(0, 1200);
      expect(head).toContain("npx langwatch report --user-approved");
    });
  });

  describe("given the docs entry pages", () => {
    /** @scenario "Key docs entry pages carry a small note for agents" */
    it("includes the agent notice snippet on each main entry page", () => {
      const entryPages = [
        "docs/introduction.mdx",
        "docs/concepts.mdx",
        "docs/integration/overview.mdx",
        "docs/integration/quick-start.mdx",
        "docs/integration/cli.mdx",
        "docs/integration/mcp.mdx",
      ];
      for (const page of entryPages) {
        expect(read(page), `${page} lost the agent notice`).toContain(
          "<AgentReportNotice />",
        );
      }
      expect(existsSync(join(REPO_ROOT, "docs/snippets/agent-report-notice.mdx"))).toBe(
        true,
      );
    });
  });

  describe("given the docs footer", () => {
    /** @scenario "The docs footer note for agents reads in full" */
    it("keeps the label short enough and un-clipped by the theme", () => {
      const config = JSON.parse(read("docs/docs.json")) as {
        footer: { links: { items: { label: string; href: string }[] }[] };
      };
      const link = config.footer.links
        .flatMap((group) => group.items)
        .find((item) => item.label.includes("report an issue"));

      expect(link, "the docs footer lost the agent report link").toBeDefined();
      // The theme renders no group header for a single group, so the label
      // carries the framing, and the command is the point of the note.
      expect(link!.label).toMatch(/^For agents:/);
      expect(link!.label).toContain("npx langwatch report");
      // The theme truncates footer labels at `max-w-36` (144px) from md up;
      // style.css lifts that for this href, leaving the ~500px column as the
      // real budget. The current label measures 361px, so cap the length with
      // room to spare rather than letting it grow into a wrap on desktop.
      expect(link!.label.length).toBeLessThanOrEqual(60);
      // Mintlify strips the fragment from footer hrefs, so a `#section` deep
      // link here silently lands on the page top. Keep the plain page URL.
      expect(link!.href).not.toContain("#");

      // The override has to still DO something: a surviving selector with the
      // declarations removed would silently restore the clipping.
      const escapedHref = link!.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rule = new RegExp(
        `footer a\\[href="${escapedHref}"\\]\\s*\\{([^}]*)\\}`,
      ).exec(read("docs/style.css"));
      expect(rule, "style.css lost the footer link override").not.toBeNull();
      expect(rule![1]).toContain("max-width: none");
      expect(rule![1]).toContain("overflow: visible");
      expect(rule![1]).toContain("text-overflow: clip");
    });
  });

  describe("given the support documentation", () => {
    /** @scenario "The docs have a page documenting the report command" */
    it("documents the report modes and the redaction guarantees", () => {
      const support = read("docs/support.mdx");
      expect(support).toContain("## Reporting Issues from Coding Agents");
      expect(support).toContain("Full session report");
      expect(support).toContain("Summary report");
      expect(support).toContain("packages/redaction/src/sessionReport.ts");
      expect(support).toContain("report_issue");
    });
  });
});
