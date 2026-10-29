import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { DOCS_URL } from "../../lib/site-path.ts";
import { allPagesMarkdown, type PageSeo } from "./all-pages-report.ts";
import { auditRunSchema, readBudgets } from "./budgets.ts";
import { builtBasePath, checkSeo, sitemapPages } from "./seo-check.ts";

/* Merges the every-page Lighthouse shards (run.ts --all-pages --shard i/n) with the static
   search checks on every page into one report. Never fails on scores: informational. */

const options = z.object({
  "out-dir": z.string().default("dist"),
  "base-path": z.string().default("/docs"),
  "shards-dir": z.string(),
  "report-dir": z.string(),
  summary: z.string().optional(),
  commit: z.string().optional(),
  "full-report-url": z.string().optional(),
});

const shardReport = z.object({ runs: z.array(auditRunSchema) });

/** Every audit-report.json below a directory, one per downloaded shard artifact. */
function shardFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return shardFiles(file);
    return entry.name === "audit-report.json" ? [file] : [];
  });
}

function sitePath(url: string) {
  return url.startsWith(DOCS_URL) ? url.slice(DOCS_URL.length) || "/" : null;
}

function main() {
  const { values } = parseArgs({
    options: {
      "out-dir": { type: "string" },
      "base-path": { type: "string" },
      "shards-dir": { type: "string" },
      "report-dir": { type: "string" },
      summary: { type: "string" },
      commit: { type: "string" },
      "full-report-url": { type: "string" },
    },
  });
  const args = options.parse(values);
  const outDir = path.resolve(args["out-dir"]);
  const basePath = args["base-path"].replace(/\/$/, "");
  const built = builtBasePath({ outDir });
  if (built !== null && built !== basePath)
    throw new Error(
      `${outDir} was built for base path "${built || "/"}", not "${basePath || "/"}"`,
    );
  const budgets = readBudgets();

  const pages = sitemapPages({ outDir })
    .map(sitePath)
    .filter((page) => page !== null);
  const files = shardFiles(path.resolve(args["shards-dir"]));
  const runs = files.flatMap(
    (file) => shardReport.parse(JSON.parse(readFileSync(file, "utf8"))).runs,
  );

  const { issues } = checkSeo({ outDir, basePath, seo: budgets.seo });
  const byPage = new Map<string, string[]>(pages.map((page) => [page, []]));
  const siteIssues = [];
  for (const issue of issues) {
    const page = sitePath(issue.page);
    const list = page === null ? undefined : byPage.get(page);
    if (list) list.push(issue.code);
    else siteIssues.push(issue);
  }
  const seo: PageSeo[] = [...byPage].map(([page, codes]) => ({
    path: page,
    issues: [...new Set(codes)],
  }));

  const input = {
    pages,
    runs,
    seo,
    siteIssues,
    budgets,
    commit: args.commit,
    fullReportUrl: args["full-report-url"],
  };
  const { comment, full, inline } = allPagesMarkdown({ input });
  const reportDir = path.resolve(args["report-dir"]);
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(path.join(reportDir, "comment.md"), comment);
  writeFileSync(path.join(reportDir, "full.md"), full);
  writeFileSync(
    path.join(reportDir, "report.json"),
    JSON.stringify({ pages, runs, seo, siteIssues }),
  );
  if (args.summary) appendFileSync(args.summary, full);
  process.stdout.write(
    `[docs-audit] every page: ${pages.length} pages, ${runs.length} runs from ${files.length} shards; ` +
      `comment ${comment.length} characters, full table ${inline ? "inline" : "linked"}\n`,
  );
}

main();
