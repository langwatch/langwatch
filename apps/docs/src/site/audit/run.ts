import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import { docsRoot } from "../../paths.ts";
import { startPreview } from "../preview-server.ts";
import { agentReadinessMarkdown, agentReadinessReport } from "./agent-readiness-report.ts";
import { checkAgentReadiness } from "./agent-readiness.ts";
import {
  auditRunSchema,
  DEFAULT_BUDGETS_FILE,
  evaluateBudgets,
  FORM_FACTORS,
  readBudgets,
  type AuditRun,
  type FormFactor,
  type PageBudget,
} from "./budgets.ts";
import { summaryMarkdown } from "./report.ts";
import { applyKnownIssues, builtBasePath, checkSeo, knownIssuesOf } from "./seo-check.ts";

const RUNNER = fileURLToPath(new URL("./lighthouse-run.ts", import.meta.url));
const list = z.string().transform((value) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);

const optionsSchema = z.object({
  "out-dir": z.string().default("dist"),
  "base-path": z.string().default("/docs"),
  "report-dir": z.string().optional(),
  summary: z.string().optional(),
  pages: list.optional(),
  "form-factors": list.pipe(z.array(z.enum(FORM_FACTORS))).default([...FORM_FACTORS]),
  concurrency: z.coerce.number().int().min(1).optional(),
  runs: z.coerce.number().int().min(1).default(1),
  json: z.boolean().default(false),
  lhr: z.boolean().default(false),
  "static-only": z.boolean().default(false),
  "skip-static": z.boolean().default(false),
  "write-seo-baseline": z.boolean().default(false),
  "write-agent-baseline": z.boolean().default(false),
});

function readOptions() {
  const { values } = parseArgs({
    options: {
      "out-dir": { type: "string" },
      "base-path": { type: "string" },
      "report-dir": { type: "string" },
      summary: { type: "string" },
      pages: { type: "string" },
      "form-factors": { type: "string" },
      concurrency: { type: "string" },
      runs: { type: "string" },
      json: { type: "boolean" },
      lhr: { type: "boolean" },
      "static-only": { type: "boolean" },
      "skip-static": { type: "boolean" },
      "write-seo-baseline": { type: "boolean" },
      "write-agent-baseline": { type: "boolean" },
    },
  });
  return optionsSchema.parse(values);
}

function log({ json, message }: { json: boolean; message: string }) {
  (json ? process.stderr : process.stdout).write(`[docs-audit] ${message}\n`);
}

/** A page by budget id, or an ad hoc site path held to the default budgets. */
function selectPage({ pages, entry }: { pages: PageBudget[]; entry: string }): PageBudget {
  const page = pages.find((candidate) => candidate.id === entry || candidate.path === entry);
  if (page) return page;
  if (!entry.startsWith("/"))
    throw new Error(`unknown page ${entry}; use a budget id or a /site/path`);
  return { id: entry, path: entry, why: "ad hoc", categories: {}, knownFailures: {} };
}

function selectPages({ pages, selected }: { pages: PageBudget[]; selected?: string[] }) {
  return selected ? selected.map((entry) => selectPage({ pages, entry })) : pages;
}

function parseRun({ stdout }: { stdout: string }) {
  try {
    const parsed = auditRunSchema.safeParse(JSON.parse(stdout.trim().split("\n").at(-1) ?? ""));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function runLighthouse({
  url,
  page,
  formFactor,
  lhr,
}: {
  url: string;
  page: PageBudget;
  formFactor: FormFactor;
  lhr?: string;
}): Promise<AuditRun> {
  const args = [RUNNER, "--url", url, "--page", page.id, "--path", page.path];
  args.push("--form-factor", formFactor, ...(lhr ? ["--lhr", lhr] : []));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      const parsed = code === 0 ? parseRun({ stdout }) : null;
      if (parsed) return resolve(parsed);
      resolve({
        page: page.id,
        path: page.path,
        formFactor,
        runtimeError: `runner exited ${code}: ${stderr.trim().split("\n").slice(-3).join(" ")}`,
        scores: {},
        metrics: {
          firstContentfulPaint: null,
          largestContentfulPaint: null,
          totalBlockingTime: null,
          cumulativeLayoutShift: null,
          speedIndex: null,
        },
        transferBytes: null,
        requests: null,
        agentic: null,
        failingAudits: [],
        opportunities: [],
        durationMs: 0,
      });
    });
  });
}

async function pool<T, R>({
  items,
  limit,
  work,
}: {
  items: T[];
  limit: number;
  work: (item: T) => Promise<R>;
}) {
  const results = Array.from<R>({ length: items.length });
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]);
      }
    }),
  );
  return results;
}

/** The run with the median performance score, so one noisy run neither passes nor fails a page. */
function medianRun({ runs }: { runs: AuditRun[] }) {
  const sorted = runs.toSorted(
    (a, b) => (a.scores.performance ?? -1) - (b.scores.performance ?? -1),
  );
  return sorted[Math.floor(sorted.length / 2)];
}

async function checkExportTypes({ origin, exports }: { origin: string; exports: string[] }) {
  const wrong = await pool({
    items: exports,
    limit: 16,
    work: async (href) => {
      const response = await fetch(`${origin}${href}`, { method: "HEAD" });
      const type = response.headers.get("content-type") ?? "";
      return response.status === 200 && type.startsWith("text/markdown")
        ? null
        : {
            page: href,
            code: "markdown-content-type",
            detail: `${response.status} ${type || "no type"}`,
          };
    },
  });
  return wrong.filter((issue) => issue !== null);
}

/** Agent readiness against its known gaps; `write` replaces them with today's. */
function agentReadiness({
  outDir,
  budgets,
  json,
  write,
}: {
  outDir: string;
  budgets: ReturnType<typeof readBudgets>;
  json: boolean;
  write: boolean;
}) {
  const result = checkAgentReadiness({ outDir, docsRoot, budget: budgets.agentReadiness });
  let known = budgets.agentReadiness.known;
  if (write) {
    known = knownIssuesOf({ issues: result.issues });
    const raw = JSON.parse(readFileSync(DEFAULT_BUDGETS_FILE, "utf8"));
    raw.agentReadiness.known = known;
    writeFileSync(DEFAULT_BUDGETS_FILE, `${JSON.stringify(raw, null, 2)}\n`);
    log({
      json,
      message: `wrote ${result.issues.length} known agent readiness gaps to budgets.json`,
    });
  }
  const gate = applyKnownIssues({ issues: result.issues, known });
  log({
    json,
    message: `agent readiness: ${result.score}/100, ${gate.failures.length} new gaps, ${gate.known} known`,
  });
  return { result, gate };
}

/** Lighthouse over the selected pages and form factors, the median of each page's runs. */
async function lighthouseRuns({
  options,
  budgets,
  origin,
  basePath,
  reportDir,
  json,
}: {
  options: ReturnType<typeof readOptions>;
  budgets: ReturnType<typeof readBudgets>;
  origin: string;
  basePath: string;
  reportDir: string;
  json: boolean;
}): Promise<AuditRun[]> {
  const pages = selectPages({ pages: budgets.pages, selected: options.pages });
  const tasks = pages.flatMap((page) =>
    options["form-factors"].flatMap((formFactor) =>
      Array.from({ length: options.runs }, (_, attempt) => ({ page, formFactor, attempt })),
    ),
  );
  const limit =
    options.concurrency ?? Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2)));
  const lhrDir = path.join(reportDir, "lighthouse");
  if (options.lhr) mkdirSync(lhrDir, { recursive: true });
  log({ json, message: `lighthouse: ${tasks.length} runs, ${limit} at a time` });
  const all = await pool({
    items: tasks,
    limit,
    work: async ({ page, formFactor, attempt }) => {
      const run = await runLighthouse({
        url: `${origin}${basePath}${page.path}`,
        page,
        formFactor,
        lhr: options.lhr
          ? path.join(
              lhrDir,
              `${page.id.replace(/[^a-z0-9-]+/gi, "_")}-${formFactor}-${attempt}.json`,
            )
          : undefined,
      });
      log({
        json,
        message: `${page.id} ${formFactor}: ${run.runtimeError ?? `${Math.round(run.durationMs / 1000)} s`}`,
      });
      return run;
    },
  });
  return pages.flatMap((page) =>
    options["form-factors"].map((formFactor) =>
      medianRun({
        runs: all.filter((run) => run.page === page.id && run.formFactor === formFactor),
      }),
    ),
  );
}

/** Stops before any check when the build was made for another mount: every URL would be wrong. */
function assertBuiltFor({ outDir, basePath }: { outDir: string; basePath: string }) {
  const built = builtBasePath({ outDir });
  if (built === null || built === basePath) return;
  throw new Error(
    `${outDir} was built for base path "${built || "/"}", not "${basePath || "/"}": ` +
      `build it with --base-path ${basePath || "/"} (CI audits a /docs build), or pass --base-path ${built || "/"}`,
  );
}

async function main() {
  const started = nowInstant().epochMilliseconds;
  const options = readOptions();
  const json = options.json;
  const outDir = path.resolve(options["out-dir"]);
  const basePath = options["base-path"].replace(/\/$/, "");
  const reportDir = path.resolve(options["report-dir"] ?? outDir);
  const budgets = readBudgets();
  assertBuiltFor({ outDir, basePath });

  const seoResult = options["skip-static"]
    ? { pages: 0, issues: [], exports: [] }
    : checkSeo({ outDir, basePath, seo: budgets.seo });
  let known = options["skip-static"] ? {} : budgets.seo.known;
  if (options["write-seo-baseline"]) {
    known = knownIssuesOf({ issues: seoResult.issues });
    const raw = JSON.parse(readFileSync(DEFAULT_BUDGETS_FILE, "utf8"));
    raw.seo.known = known;
    writeFileSync(DEFAULT_BUDGETS_FILE, `${JSON.stringify(raw, null, 2)}\n`);
    log({ json, message: `wrote ${seoResult.issues.length} known issues to budgets.json` });
  }
  const seo = applyKnownIssues({ issues: seoResult.issues, known });
  const agent = options["skip-static"]
    ? null
    : agentReadiness({ outDir, budgets, json, write: options["write-agent-baseline"] });
  log({
    json,
    message: `static: ${seoResult.pages} pages, ${seo.failures.length} new issues, ${seo.known} known`,
  });

  const server = await startPreview({ outDir, port: 0, basePath });
  let runs: AuditRun[] = [];
  try {
    const origin = new URL(server.resolvedUrls?.local[0] ?? "http://127.0.0.1").origin;
    seo.failures.push(...(await checkExportTypes({ origin, exports: seoResult.exports })));
    if (!options["static-only"])
      runs = await lighthouseRuns({ options, budgets, origin, basePath, reportDir, json });
  } finally {
    await new Promise((resolve) => server.httpServer.close(resolve));
  }

  const { failures, notes } = evaluateBudgets({
    runs,
    budgets: { ...budgets, pages: selectPages({ pages: budgets.pages, selected: options.pages }) },
  });
  const wallClockMs = nowInstant().epochMilliseconds - started;
  const report = { wallClockMs, runs, failures, notes, seo: { pages: seoResult.pages, ...seo } };
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(path.join(reportDir, "audit-report.json"), JSON.stringify(report, null, 2));
  const agentFailures = agent?.gate.failures.length ?? 0;
  if (agent)
    writeFileSync(
      path.join(reportDir, "agent-readiness.json"),
      JSON.stringify(agentReadinessReport(agent), null, 2),
    );
  const markdown =
    summaryMarkdown({ runs, failures, notes, seo: report.seo, wallClockMs, agentFailures }) +
    (agent ? agentReadinessMarkdown(agent) : "");
  if (options.summary) appendFileSync(options.summary, markdown);
  if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else process.stdout.write(markdown);
  if (failures.length > 0 || seo.failures.length > 0 || agentFailures > 0) process.exitCode = 1;
}

await main();
