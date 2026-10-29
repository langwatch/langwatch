import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { type DocsItem, readDocsConfig } from "../../features/navigation/compile.ts";
import { DOCS_URL } from "../../lib/site-path.ts";
import {
  approximateTokens,
  checkPageMarkdown,
  TOKENISER,
  type AgentIssue,
} from "./agent-markdown.ts";
import type { Budgets } from "./budgets.ts";
import { pageFile, sitemapPages } from "./seo-check.ts";

type AgentBudget = Budgets["agentReadiness"];

/** Each check, the issue codes that fail it, and whether it is held per page or per site file. */
export const AGENT_CHECKS = [
  { id: "tokens", label: "Fits in context", codes: ["tokens-over-budget"] },
  {
    id: "opening",
    label: "Answers first",
    codes: ["export-missing-description", "first-paragraph-missing", "first-paragraph-preamble"],
  },
  {
    id: "code",
    label: "Code pastes as is",
    codes: [
      "code-untagged",
      "code-shell-prompt",
      "code-placeholder-only",
      "code-missing-import",
      "code-unparseable",
    ],
  },
  {
    id: "fidelity",
    label: "Markdown export is clean",
    codes: ["export-missing", "export-raw-component"],
  },
  {
    id: "integration",
    label: "Integration path complete",
    codes: [
      "integration-no-install",
      "integration-no-env-var",
      "integration-no-complete-sample",
      "integration-no-verify",
    ],
  },
  {
    id: "discovery",
    label: "Discoverable",
    codes: [
      "llms-full-missing-page",
      "head-missing-agent-links",
      "robots-crawler-unnamed",
      "robots-crawler-blocked",
      "agent-card-invalid",
      "skills-index-invalid",
      "skills-digest-mismatch",
      "agents-txt-missing",
    ],
  },
] as const;

const HEAD_RELS = ["llms-txt", "llms-full-txt", "agent-card", "agent-skills"];

function collectPages({ items }: { items: DocsItem[] }): string[] {
  return items.flatMap((item) => {
    if (typeof item === "string") return [item];
    return item ? collectPages({ items: item.pages ?? [] }) : [];
  });
}

/** Integration pages: everything under the configured navigation groups, plus listed pages. */
export function integrationPages({
  docsRoot,
  selection,
}: {
  docsRoot: string;
  selection: AgentBudget["integration"];
}) {
  const anchors = readDocsConfig({ docsRoot }).navigation?.anchors ?? [];
  const slugs = new Set(selection.pages);
  for (const { anchor, group } of selection.groups) {
    const groups = anchors.find((candidate) => candidate.anchor === anchor)?.groups ?? [];
    for (const item of groups)
      if (item && typeof item === "object" && item.group === group)
        for (const slug of collectPages({ items: item.pages ?? [] })) slugs.add(slug);
  }
  for (const slug of selection.exclude) slugs.delete(slug);
  return new Set([...slugs].map((slug) => `/${slug}`));
}

function readText({ file }: { file: string }) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/* Each user agent's rules; consecutive User-agent lines share the rules that follow them. */
function robotsGroups({ robots }: { robots: string }) {
  const groups = new Map<string, string[]>();
  let agents: string[] = [];
  let collecting = false;
  for (const raw of robots.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    const [field, ...rest] = line.split(":");
    if (/^user-agent$/i.test(field ?? "")) {
      const agent = rest.join(":").trim().toLowerCase();
      agents = collecting ? [...agents, agent] : [agent];
      collecting = true;
      if (!groups.has(agent)) groups.set(agent, []);
      continue;
    }
    if (!line) continue;
    collecting = false;
    for (const agent of agents) groups.get(agent)?.push(line);
  }
  return groups;
}

/** Robots groups by user agent; a crawler is named when a group lists it by name. */
export function robotsIssues({ robots, crawlers }: { robots: string | null; crawlers: string[] }) {
  const groups = robotsGroups({ robots: robots ?? "" });
  return crawlers.flatMap((crawler): AgentIssue[] => {
    const rules = groups.get(crawler.toLowerCase());
    const page = `robots.txt#${crawler}`;
    if (!rules)
      return [{ page, code: "robots-crawler-unnamed", detail: `no User-agent: ${crawler}` }];
    return rules.some((rule) => /^disallow:\s*\/\s*$/i.test(rule))
      ? [{ page, code: "robots-crawler-blocked", detail: `${crawler} is disallowed` }]
      : [];
  });
}

const cardSchema = z.looseObject({
  name: z.string().min(1),
  description: z.string().min(1),
  url: z.url({ protocol: /^https$/ }),
  version: z.string().min(1),
  skills: z
    .array(z.looseObject({ id: z.string().min(1), name: z.string(), description: z.string() }))
    .min(1),
});
const skillsIndexSchema = z.looseObject({
  skills: z
    .array(
      z.looseObject({
        name: z.string().min(1),
        description: z.string().min(1),
        url: z.url(),
        digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      }),
    )
    .min(1),
});

function parsed<T>({ schema, text }: { schema: z.ZodType<T>; text: string | null }) {
  if (text === null) return { error: "absent" } as const;
  try {
    const result = schema.safeParse(JSON.parse(text));
    return result.success
      ? ({ data: result.data } as const)
      : ({
          error: result.error.issues
            .map((issue) => issue.path.join(".") || issue.message)
            .join(", "),
        } as const);
  } catch (error) {
    return { error: (error as Error).message } as const;
  }
}

function digestIssues({
  outDir,
  skill,
}: {
  outDir: string;
  skill: { name: string; url: string; digest: string };
}): AgentIssue[] {
  const relative = skill.url.startsWith(`${DOCS_URL}/`)
    ? skill.url.slice(DOCS_URL.length + 1)
    : null;
  const file = relative ? path.join(outDir, relative) : null;
  const bytes = file && existsSync(file) ? readFileSync(file) : null;
  const digest = bytes && `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest === skill.digest) return [];
  const detail = bytes
    ? "digest does not match the published file"
    : `${skill.url} is not in the build`;
  return [{ page: `agent-skills/${skill.name}`, code: "skills-digest-mismatch", detail }];
}

/** The agent card, the skills index and every SKILL.md digest it promises. */
function discoveryFileIssues({ outDir }: { outDir: string }): AgentIssue[] {
  const issues: AgentIssue[] = [];
  const read = (file: string) => readText({ file: path.join(outDir, file) });
  const card = parsed({ schema: cardSchema, text: read(".well-known/agent-card.json") });
  if (card.error)
    issues.push({ page: "agent-card.json", code: "agent-card-invalid", detail: card.error });
  const index = parsed({
    schema: skillsIndexSchema,
    text: read(".well-known/agent-skills/index.json"),
  });
  if (index.error)
    issues.push({
      page: "agent-skills/index.json",
      code: "skills-index-invalid",
      detail: index.error,
    });
  for (const skill of index.data?.skills ?? []) issues.push(...digestIssues({ outDir, skill }));
  if (!read("agents.txt")?.trim())
    issues.push({ page: "agents.txt", code: "agents-txt-missing", detail: "absent or empty" });
  return issues;
}

function headRels({ html }: { html: string }) {
  const head = html.slice(0, html.search(/<\/head>/i) + 1 || html.length);
  return new Set([...head.matchAll(/<link\b[^>]*\brel="([^"]+)"/gi)].map((match) => match[1]));
}

/** Sitemap entries and how many carry a last-modified date. */
export function sitemapFreshness({ sitemap }: { sitemap: string }) {
  const entries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => match[1] ?? "");
  return {
    total: entries.length,
    dated: entries.filter((entry) => entry.includes("<lastmod>")).length,
  };
}

function largest<T>({
  items,
  size,
  count = 10,
}: {
  items: T[];
  size: (item: T) => number;
  count?: number;
}) {
  return items.toSorted((a, b) => size(b) - size(a)).slice(0, count);
}

/** Pass rate per check over its subjects, and the score as their mean, out of 100. */
export function scoreChecks({
  issues,
  subjects,
}: {
  issues: AgentIssue[];
  subjects: Record<(typeof AGENT_CHECKS)[number]["id"], number>;
}) {
  const checks = AGENT_CHECKS.map((check) => {
    const codes = new Set<string>(check.codes);
    const failing = new Set(
      issues.filter((issue) => codes.has(issue.code)).map((issue) => issue.page),
    ).size;
    const applicable = subjects[check.id];
    const passRate = applicable === 0 ? 1 : (applicable - failing) / applicable;
    return { id: check.id, label: check.label, applicable, failing, passRate };
  });
  const score = Math.round(
    (checks.reduce((sum, check) => sum + check.passRate, 0) / checks.length) * 100,
  );
  return { score, checks };
}

/** Agent readiness over every sitemap page, read from the Markdown exports agents fetch. */
export function checkAgentReadiness({
  outDir,
  docsRoot,
  budget,
}: {
  outDir: string;
  docsRoot: string;
  budget: AgentBudget;
}) {
  const integration = integrationPages({ docsRoot, selection: budget.integration });
  const llmsFull = readText({ file: path.join(outDir, "llms-full.txt") }) ?? "";
  const llmsTxt = readText({ file: path.join(outDir, "llms.txt") }) ?? "";
  const inFull = new Set([...llmsFull.matchAll(/^> Page: (\S+)$/gm)].map((match) => match[1]));
  const issues: AgentIssue[] = [];
  const pageTokens: { page: string; tokens: number }[] = [];
  const urls = sitemapPages({ outDir });
  for (const url of urls) {
    const page = url.slice(DOCS_URL.length) || "/";
    const markdown = readText({
      file: path.join(outDir, page === "/" ? "index.md" : `.${page}.md`),
    });
    if (markdown === null) {
      issues.push({ page, code: "export-missing", detail: `${page}.md is not in the build` });
      continue;
    }
    const result = checkPageMarkdown({
      markdown,
      integration: integration.has(page),
      pageTokens: budget.pageTokens,
    });
    pageTokens.push({ page, tokens: result.tokens });
    issues.push(...result.issues.map((issue) => ({ page, ...issue })));
    if (!inFull.has(url))
      issues.push({ page, code: "llms-full-missing-page", detail: "not in llms-full.txt" });
    const html = readText({ file: pageFile({ outDir, url }) ?? "" });
    const rels = html ? headRels({ html }) : new Set<string>();
    const missing = HEAD_RELS.filter((rel) => !rels.has(rel));
    if (missing.length > 0)
      issues.push({ page, code: "head-missing-agent-links", detail: `no ${missing.join(", ")}` });
  }
  const robots = readText({ file: path.join(outDir, "robots.txt") });
  issues.push(
    ...robotsIssues({ robots, crawlers: budget.crawlers }),
    ...discoveryFileIssues({ outDir }),
  );
  const integrationListed = urls.filter((url) =>
    integration.has(url.slice(DOCS_URL.length)),
  ).length;
  const { score, checks } = scoreChecks({
    issues,
    subjects: {
      tokens: urls.length,
      opening: urls.length,
      code: urls.length,
      fidelity: urls.length,
      integration: integrationListed,
      discovery: urls.length + budget.crawlers.length + 3,
    },
  });
  const directoryLines = llmsTxt.split("\n").filter((line) => line.startsWith("- ["));
  return {
    pages: urls.length,
    integrationPages: integrationListed,
    score,
    checks,
    issues,
    tokens: {
      tokeniser: TOKENISER,
      pageBudget: budget.pageTokens,
      llmsTxt: approximateTokens({ text: llmsTxt }),
      llmsFull: approximateTokens({ text: llmsFull }),
      largestPages: largest({ items: pageTokens, size: (item) => item.tokens }),
      largestDirectoryEntries: largest({
        items: directoryLines.map((line) => ({
          page: /\]\((\S+?)\)/.exec(line)?.[1]?.slice(DOCS_URL.length).replace(/\.md$/, "") ?? line,
          tokens: approximateTokens({ text: line }),
        })),
        size: (item) => item.tokens,
      }),
    },
    freshness: sitemapFreshness({
      sitemap: readText({ file: path.join(outDir, "sitemap.xml") }) ?? "",
    }),
  };
}

export type AgentReadiness = ReturnType<typeof checkAgentReadiness>;
