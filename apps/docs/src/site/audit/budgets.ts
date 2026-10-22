import { readFileSync } from "node:fs";

import { z } from "zod";

export const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;
export const FORM_FACTORS = ["mobile", "desktop"] as const;

const category = z.enum(CATEGORIES);
const formFactor = z.enum(FORM_FACTORS);
const score = z.number().min(0).max(1);
const categoryBudgets = z.partialRecord(category, score);
const range = z.object({ min: z.number().int().min(0), max: z.number().int().positive() });

const pageSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  path: z.string().startsWith("/"),
  why: z.string().min(1),
  categories: z.partialRecord(formFactor, categoryBudgets).default({}),
  maxCumulativeLayoutShift: z.number().min(0).optional(),
  maxTransferBytes: z.number().int().positive().optional(),
  maxRequests: z.number().int().positive().optional(),
  /** Audit id -> why it may fail on this page. Anything else failing fails the run. */
  knownFailures: z.record(z.string(), z.string().min(1)).default({}),
});

export const budgetsSchema = z.strictObject({
  $comment: z.string().optional(),
  categories: z.record(formFactor, z.record(category, score)),
  maxCumulativeLayoutShift: z.number().min(0),
  maxTransferBytes: z.number().int().positive(),
  maxRequests: z.number().int().positive(),
  /** Categories whose individual failing audits fail the run, not only the category score. */
  gatedAuditCategories: z.array(category),
  pages: z.array(pageSchema).min(1),
  seo: z.strictObject({
    title: range,
    description: range,
    /** Issue code -> pages that had it when the gate landed; new pages or codes fail. */
    known: z.record(z.string(), z.array(z.string())).default({}),
  }),
});

export type Budgets = z.infer<typeof budgetsSchema>;
export type PageBudget = Budgets["pages"][number];
export type Category = z.infer<typeof category>;
export type FormFactor = z.infer<typeof formFactor>;

export const DEFAULT_BUDGETS_FILE = new URL("./budgets.json", import.meta.url);

export function readBudgets({ file = DEFAULT_BUDGETS_FILE }: { file?: URL | string } = {}) {
  return budgetsSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

const failingAudit = z.object({ id: z.string(), category, title: z.string(), score: z.number() });

/** What one Lighthouse run measured, reduced to what the budgets and the summary read. */
export const auditRunSchema = z.object({
  page: z.string(),
  path: z.string(),
  formFactor,
  runtimeError: z.string().nullable(),
  scores: z.partialRecord(category, z.number().nullable()),
  metrics: z.object({
    firstContentfulPaint: z.number().nullable(),
    largestContentfulPaint: z.number().nullable(),
    totalBlockingTime: z.number().nullable(),
    cumulativeLayoutShift: z.number().nullable(),
    speedIndex: z.number().nullable(),
  }),
  transferBytes: z.number().nullable(),
  requests: z.number().nullable(),
  failingAudits: z.array(failingAudit),
  opportunities: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      savingsMs: z.number(),
      savingsBytes: z.number(),
    }),
  ),
  durationMs: z.number(),
});

export type AuditRun = z.infer<typeof auditRunSchema>;

export type BudgetFinding = {
  page: string;
  formFactor: FormFactor;
  code:
    | "lighthouse-error"
    | "category-below-budget"
    | "layout-shift-over-budget"
    | "transfer-over-budget"
    | "requests-over-budget"
    | "audit-failing"
    | "known-failure-passes";
  detail: string;
};

function checkRun({ run, page, budgets }: { run: AuditRun; page: PageBudget; budgets: Budgets }) {
  const findings: BudgetFinding[] = [];
  const add = (code: BudgetFinding["code"], detail: string) =>
    findings.push({ page: run.page, formFactor: run.formFactor, code, detail });
  if (run.runtimeError) {
    add("lighthouse-error", run.runtimeError);
    return { findings, notes: [] };
  }
  const minimums = { ...budgets.categories[run.formFactor], ...page.categories[run.formFactor] };
  for (const name of CATEGORIES) {
    const actual = run.scores[name];
    const minimum = minimums[name];
    if (minimum === undefined) continue;
    if (actual === null || actual === undefined || actual < minimum)
      add("category-below-budget", `${name} ${formatScore(actual)} < ${formatScore(minimum)}`);
  }
  const shift = run.metrics.cumulativeLayoutShift ?? 0;
  const maxShift = page.maxCumulativeLayoutShift ?? budgets.maxCumulativeLayoutShift;
  if (shift > maxShift) add("layout-shift-over-budget", `CLS ${shift.toFixed(3)} > ${maxShift}`);
  const maxBytes = page.maxTransferBytes ?? budgets.maxTransferBytes;
  if ((run.transferBytes ?? 0) > maxBytes)
    add("transfer-over-budget", `${run.transferBytes} bytes > ${maxBytes}`);
  const maxRequests = page.maxRequests ?? budgets.maxRequests;
  if ((run.requests ?? 0) > maxRequests)
    add("requests-over-budget", `${run.requests} requests > ${maxRequests}`);
  const failing = new Set<string>();
  for (const audit of run.failingAudits) {
    if (!budgets.gatedAuditCategories.includes(audit.category)) continue;
    failing.add(audit.id);
    if (!(audit.id in page.knownFailures))
      add("audit-failing", `${audit.category}: ${audit.id} (${audit.title})`);
  }
  const notes = Object.keys(page.knownFailures)
    .filter((id) => !failing.has(id))
    .map((id) => ({ page: run.page, formFactor: run.formFactor, id }));
  return { findings, notes };
}

/**
 * Compares runs with the budgets. `failures` fail the run; `notes` name known failures that
 * now pass on every device (both were audited), so the entry can be removed and the bar raised.
 */
export function evaluateBudgets({ runs, budgets }: { runs: AuditRun[]; budgets: Budgets }) {
  const failures: BudgetFinding[] = [];
  const notes: BudgetFinding[] = [];
  const passingKnown = new Map<
    string,
    { page: string; formFactor: FormFactor; id: string; runs: number }
  >();
  for (const run of runs) {
    const page = budgets.pages.find((candidate) => candidate.id === run.page);
    if (!page) throw new Error(`no budget page named ${run.page}`);
    const result = checkRun({ run, page, budgets });
    failures.push(...result.findings);
    for (const note of result.notes) {
      const key = `${note.page} ${note.id}`;
      const seen = passingKnown.get(key);
      passingKnown.set(key, { ...note, runs: (seen?.runs ?? 0) + 1 });
    }
  }
  for (const note of passingKnown.values()) {
    const ofPage = runs.filter((run) => run.page === note.page && !run.runtimeError);
    const devices = new Set(ofPage.map((run) => run.formFactor));
    if (note.runs < ofPage.length || devices.size < FORM_FACTORS.length) continue;
    notes.push({
      page: note.page,
      formFactor: note.formFactor,
      code: "known-failure-passes",
      detail: `${note.id} passes now; remove it from knownFailures`,
    });
  }
  return { failures, notes };
}

export function formatScore(value: number | null | undefined) {
  return value === null || value === undefined ? "n/a" : String(Math.round(value * 100));
}
