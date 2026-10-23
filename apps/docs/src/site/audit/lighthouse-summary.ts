import type lighthouse from "lighthouse";

import { AGENTIC_CATEGORY, CATEGORIES, type AuditRun, type Category } from "./budgets.ts";

type Result = NonNullable<Awaited<ReturnType<typeof lighthouse>>>["lhr"];
type Audit = Result["audits"][string];

function numeric({ audits, id }: { audits: Result["audits"]; id: string }) {
  return audits[id]?.numericValue ?? null;
}

function savings({ audit }: { audit: Audit }) {
  const metric = audit.metricSavings ?? {};
  const details = audit.details as { overallSavingsBytes?: number } | undefined;
  return {
    savingsMs: (metric.LCP ?? 0) + (metric.FCP ?? 0) + (metric.TBT ?? 0),
    savingsBytes: details?.overallSavingsBytes ?? 0,
  };
}

/* Lighthouse's own pass rule for this checklist: binary checks pass at 1, numeric ones at 0.9. */
function agenticChecks({ lhr }: { lhr: Result }): AuditRun["agentic"] {
  const category = lhr.categories[AGENTIC_CATEGORY];
  if (!category) return null;
  const applicable = category.auditRefs
    .map((ref) => lhr.audits[ref.id])
    .filter((audit) => audit && audit.scoreDisplayMode !== "notApplicable" && audit.score !== null);
  const failed = applicable.filter((audit) => (audit.score ?? 0) < 0.9).map((audit) => audit.id);
  return { passed: applicable.length - failed.length, applicable: applicable.length, failed };
}

/** The parts of a Lighthouse result the budgets and the summary read. */
export function summariseResult({
  lhr,
  page,
  pagePath,
  formFactor,
  durationMs,
}: {
  lhr: Result;
  page: string;
  pagePath: string;
  formFactor: AuditRun["formFactor"];
  durationMs: number;
}): AuditRun {
  const { audits } = lhr;
  const failingAudits = CATEGORIES.flatMap((category: Category) =>
    (lhr.categories[category]?.auditRefs ?? []).flatMap((ref) => {
      const audit = audits[ref.id];
      const scored =
        audit && (audit.scoreDisplayMode === "binary" || audit.scoreDisplayMode === "numeric");
      if (!scored || audit.score === null || audit.score >= 1 || category === "performance")
        return [];
      return [{ id: ref.id, category, title: audit.title, score: audit.score }];
    }),
  );
  const opportunities = (lhr.categories.performance?.auditRefs ?? [])
    .map((ref) => audits[ref.id])
    .filter((audit) => audit && audit.score !== null && audit.score < 1)
    .map((audit) => ({ id: audit.id, title: audit.title, ...savings({ audit }) }))
    .filter((entry) => entry.savingsMs > 0 || entry.savingsBytes > 0)
    .toSorted((a, b) => b.savingsMs - a.savingsMs || b.savingsBytes - a.savingsBytes)
    .slice(0, 5);
  const requests = audits["network-requests"]?.details as { items?: unknown[] } | undefined;
  return {
    page,
    path: pagePath,
    formFactor,
    runtimeError: lhr.runtimeError ? `${lhr.runtimeError.code}: ${lhr.runtimeError.message}` : null,
    scores: Object.fromEntries(
      CATEGORIES.map((category) => [category, lhr.categories[category]?.score ?? null]),
    ),
    metrics: {
      firstContentfulPaint: numeric({ audits, id: "first-contentful-paint" }),
      largestContentfulPaint: numeric({ audits, id: "largest-contentful-paint" }),
      totalBlockingTime: numeric({ audits, id: "total-blocking-time" }),
      cumulativeLayoutShift: numeric({ audits, id: "cumulative-layout-shift" }),
      speedIndex: numeric({ audits, id: "speed-index" }),
    },
    transferBytes: numeric({ audits, id: "total-byte-weight" }),
    requests: requests?.items?.length ?? null,
    agentic: agenticChecks({ lhr }),
    failingAudits,
    opportunities,
    durationMs,
  };
}
