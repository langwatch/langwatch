import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { agentReadinessMarkdown, agentReadinessReport } from "../agent-readiness-report.ts";
import { checkAgentReadiness, integrationPages, robotsIssues } from "../agent-readiness.ts";
import { applyKnownIssues, knownIssuesOf } from "../seo-check.ts";

const DOCS = "https://langwatch.ai/docs";
const HEAD_LINKS = ["llms-txt", "llms-full-txt", "agent-card", "agent-skills"]
  .map((rel) => `<link rel="${rel}" href="${DOCS}/x">`)
  .join("");
const SKILL = "---\nname: tracing\n---\nAdd tracing.\n";
const CRAWLERS = ["GPTBot", "ClaudeBot", "CCBot"];

let root: string;
let outDir: string;
let docsRoot: string;

function write({ file, contents }: { file: string; contents: string }) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function exportOf({ slug, body }: { slug: string; body: string }) {
  return `# ${slug}\n\nWhat ${slug} does.\n\n> Page: ${DOCS}/${slug}\n\n${body}\n`;
}

const docsConfig = {
  navigation: {
    anchors: [
      {
        anchor: "Observability",
        groups: [
          { group: "Overview", pages: ["integration/overview"] },
          {
            group: "Frameworks",
            pages: [{ group: "LangChain", pages: ["integration/langchain"] }, "integration/dspy"],
          },
          { group: "SDKs", pages: ["integration/python/guide", "integration/python/reference"] },
        ],
      },
    ],
  },
};
const selection = {
  groups: [{ anchor: "Observability", group: "Frameworks" }],
  pages: ["integration/python/guide"],
  exclude: ["integration/dspy"],
};
const budget = { pageTokens: 8000, integration: selection, crawlers: CRAWLERS, known: {} };

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "agent-readiness-"));
  outDir = path.join(root, "dist");
  docsRoot = path.join(root, "docs");
  write({ file: path.join(docsRoot, "docs.json"), contents: JSON.stringify(docsConfig) });
  const pages = {
    a: { body: "LangWatch traces calls.", head: HEAD_LINKS, lastmod: true, full: true },
    "integration/python/guide": {
      body: "LangWatch traces Python.",
      head: HEAD_LINKS,
      lastmod: true,
      full: true,
    },
    b: { body: "Big page.\n\n" + "word ".repeat(400), head: "", lastmod: false, full: false },
  };
  for (const [slug, page] of Object.entries(pages)) {
    write({ file: path.join(outDir, `${slug}.md`), contents: exportOf({ slug, body: page.body }) });
    write({ file: path.join(outDir, slug, "index.html"), contents: `<head>${page.head}</head>` });
  }
  const urls = Object.entries(pages).map(
    ([slug, page]) =>
      `<url><loc>${DOCS}/${slug}</loc>${page.lastmod ? "<lastmod>2026-10-01</lastmod>" : ""}</url>`,
  );
  write({ file: path.join(outDir, "sitemap.xml"), contents: `<urlset>${urls.join("")}</urlset>` });
  const full = Object.entries(pages).filter(([, page]) => page.full);
  write({
    file: path.join(outDir, "llms-full.txt"),
    contents: full.map(([slug, page]) => exportOf({ slug, body: page.body })).join("\n---\n"),
  });
  write({
    file: path.join(outDir, "llms.txt"),
    contents: Object.keys(pages)
      .map((slug) => `- [${slug}](${DOCS}/${slug}.md): about ${slug}`)
      .join("\n"),
  });
  write({
    file: path.join(outDir, "robots.txt"),
    contents: "User-agent: *\nAllow: /\n\nUser-agent: CCBot\nDisallow: /\n",
  });
  write({
    file: path.join(outDir, ".well-known/agent-card.json"),
    contents: JSON.stringify({ name: "LangWatch" }),
  });
  write({ file: path.join(outDir, ".well-known/agent-skills/tracing/SKILL.md"), contents: SKILL });
  const digest = `sha256:${createHash("sha256").update("something else").digest("hex")}`;
  write({
    file: path.join(outDir, ".well-known/agent-skills/index.json"),
    contents: JSON.stringify({
      skills: [
        {
          name: "tracing",
          description: "Tracing",
          url: `${DOCS}/.well-known/agent-skills/tracing/SKILL.md`,
          digest,
        },
      ],
    }),
  });
  write({ file: path.join(outDir, "agents.txt"), contents: "Start with llms.txt\n" });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const issueKeys = ({ issues }: { issues: { page: string; code: string }[] }) =>
  issues.map((issue) => `${issue.code} ${issue.page}`).toSorted();

describe("integrationPages", () => {
  describe("when docs.json files framework groups and SDK guides", () => {
    /** @scenario "Integration pages are the ones the navigation files under integrations" */
    it("takes every page under a configured group, the listed pages, and drops excluded ones", () => {
      const pages = integrationPages({ docsRoot, selection });
      expect([...pages].toSorted()).toEqual([
        "/integration/langchain",
        "/integration/python/guide",
      ]);
    });
  });
});

describe("checkAgentReadiness", () => {
  describe("when the build is read", () => {
    /** @scenario "Measure each page's Markdown export in tokens" */
    it("reports the llms.txt and llms-full.txt totals with their largest contributors", () => {
      const result = checkAgentReadiness({
        outDir,
        docsRoot,
        budget: { ...budget, pageTokens: 100 },
      });
      expect(result.tokens.tokeniser).toBe("characters / 4");
      expect(result.tokens.llmsFull).toBeGreaterThan(0);
      expect(result.tokens.llmsTxt).toBeGreaterThan(0);
      expect(result.tokens.largestPages[0].page).toBe("/b");
      expect(result.tokens.largestDirectoryEntries).toHaveLength(3);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ page: "/b", code: "tokens-over-budget" }),
      );
    });

    /** @scenario "Agents can discover the documentation" */
    it("reports pages and discovery files agents cannot find or trust", () => {
      const result = checkAgentReadiness({ outDir, docsRoot, budget });
      const discovery = result.issues.filter((issue) => !issue.code.startsWith("integration-"));
      expect(issueKeys({ issues: discovery })).toEqual([
        "agent-card-invalid agent-card.json",
        "head-missing-agent-links /b",
        "llms-full-missing-page /b",
        "robots-crawler-blocked robots.txt#CCBot",
        "robots-crawler-unnamed robots.txt#ClaudeBot",
        "robots-crawler-unnamed robots.txt#GPTBot",
        "skills-digest-mismatch agent-skills/tracing",
      ]);
      expect(result.integrationPages).toBe(1);
    });

    /** @scenario "Freshness is reported, not enforced" */
    it("reports the share of dated pages without failing on a missing date", () => {
      const result = checkAgentReadiness({ outDir, docsRoot, budget });
      expect(result.freshness).toEqual({ dated: 2, total: 3 });
      expect(result.issues.some((issue) => /lastmod|fresh/.test(issue.code))).toBe(false);
      const markdown = agentReadinessMarkdown({
        result,
        gate: { failures: [], fixed: [], known: 0 },
      });
      expect(markdown).toContain("2 of 3 sitemap pages carry a last-modified date");
      expect(markdown).toContain("the production build needs the full history");
    });
  });
});

describe("robotsIssues", () => {
  describe("when crawlers share a group", () => {
    /** @scenario "Agents can discover the documentation" */
    it("counts each listed agent as named and allowed", () => {
      const robots = "User-agent: GPTBot\nUser-agent: ClaudeBot\nAllow: /\n";
      expect(robotsIssues({ robots, crawlers: ["GPTBot", "ClaudeBot"] })).toEqual([]);
    });
  });
});

describe("the agent readiness gate", () => {
  describe("when gaps are listed as known", () => {
    /** @scenario "Known agent readiness gaps are tolerated and new ones fail" */
    it("fails new gaps, reports fixed ones and writes exactly today's gaps", () => {
      const issues = [
        { page: "/b", code: "tokens-over-budget", detail: "9000 tokens", weight: 9000 },
        { page: "/c", code: "code-untagged", detail: "1 block", weight: 1 },
      ];
      const gate = applyKnownIssues({
        issues,
        known: { "tokens-over-budget": ["/b"], "code-untagged": ["/gone"] },
      });
      expect(gate.failures).toEqual([issues[1]]);
      expect(gate.fixed).toEqual([
        { page: "/gone", code: "code-untagged", detail: "no longer occurs" },
      ]);
      expect(gate.known).toBe(1);
      expect(knownIssuesOf({ issues })).toEqual({
        "code-untagged": ["/c"],
        "tokens-over-budget": ["/b"],
      });
    });
  });
});

describe("agentReadinessMarkdown", () => {
  describe("when the result has gaps", () => {
    /** @scenario "Summarise agent readiness for the pull request" */
    it("shows the score, pass rates, totals, worst pages and the delta from the known list", () => {
      const result = checkAgentReadiness({ outDir, docsRoot, budget });
      const failures = result.issues.filter((issue) => issue.page === "/b");
      const gate = {
        failures,
        fixed: [{ page: "/old", code: "code-untagged", detail: "gone" }],
        known: 3,
      };
      const markdown = agentReadinessMarkdown({ result, gate });
      expect(markdown).toContain(
        `## Agent readiness: ${result.score}/100, ${failures.length} new gaps`,
      );
      expect(markdown).toContain("| Discoverable |");
      expect(markdown).toContain("llms-full.txt");
      expect(markdown).toContain("Worst pages per check");
      expect(markdown).toContain("### New agent readiness gaps");
      expect(markdown).toContain("- `/old`: code-untagged; remove it from agentReadiness.known");
    });

    /** @scenario "Summarise agent readiness for the pull request" */
    it("writes a JSON trend record with the score, checks and the gate", () => {
      const result = checkAgentReadiness({ outDir, docsRoot, budget });
      const report = agentReadinessReport({ result, gate: { failures: [], fixed: [], known: 0 } });
      const parsed = JSON.parse(JSON.stringify(report));
      expect(parsed.score).toBe(result.score);
      expect(parsed.checks.map((check: { id: string }) => check.id)).toEqual([
        "tokens",
        "opening",
        "code",
        "fidelity",
        "integration",
        "discovery",
      ]);
      expect(parsed.issues).toBe(result.issues.length);
      expect(parsed.worstPages.discovery[0].page).toBeDefined();
      expect(parsed.gate).toEqual({ new: [], fixed: [], known: 0 });
    });
  });
});
