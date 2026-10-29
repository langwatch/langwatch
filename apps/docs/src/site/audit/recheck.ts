import type { AuditRun, FormFactor, PageBudget } from "./budgets.ts";

/** Extra runs for a page under `--recheck-below`: three runs in all. */
export const RECHECK_RUNS = 2;

export type LighthouseTask = { page: PageBudget; formFactor: FormFactor; attempt: number };

/** A page on one device, with the run that stands for it. */
export type PageMedian = { page: PageBudget; formFactor: FormFactor; run: AuditRun };

/** The run with the median performance score, so one noisy run neither passes nor fails a page. */
export function medianRun({ runs }: { runs: AuditRun[] }) {
  const sorted = runs.toSorted(
    (a, b) => (a.scores.performance ?? -1) - (b.scores.performance ?? -1),
  );
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!median) throw new Error("No audit runs to take a median of");
  return median;
}

/** The median run of every page on every device, in page order. */
export function pageMedians({
  pages,
  formFactors,
  runs,
}: {
  pages: PageBudget[];
  formFactors: FormFactor[];
  runs: AuditRun[];
}): PageMedian[] {
  return pages.flatMap((page) =>
    formFactors.map((formFactor) => ({
      page,
      formFactor,
      run: medianRun({
        runs: runs.filter((run) => run.page === page.id && run.formFactor === formFactor),
      }),
    })),
  );
}

/**
 * The passes that recheck each page whose median scored under `threshold`, one run per page in
 * a pass so a page never competes with its own recheck. A run Lighthouse could not load has no
 * score: it is reported as unloadable, not rechecked.
 */
export function recheckPasses({
  medians,
  threshold,
  firstAttempt,
}: {
  medians: PageMedian[];
  threshold: number;
  firstAttempt: number;
}): LighthouseTask[][] {
  const slow = medians.filter(({ run }) => {
    const score = run.scores.performance;
    return run.runtimeError === null && typeof score === "number" && score < threshold;
  });
  if (slow.length === 0) return [];
  return Array.from({ length: RECHECK_RUNS }, (_, extra) =>
    slow.map(({ page, formFactor }) => ({ page, formFactor, attempt: firstAttempt + extra })),
  );
}
