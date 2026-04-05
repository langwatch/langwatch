/**
 * Hook for path-based suite routing.
 *
 * Derives the active selection from the URL pathname:
 *   /simulations                                → All Runs
 *   /simulations/run-plans/:suiteSlug           → Suite detail
 *   /simulations/run-plans/:suiteSlug/:batchId  → Suite detail + highlight batch
 *   /simulations/:externalSetSlug               → External set
 *   /simulations/:externalSetSlug/:batchId      → External set + highlight batch
 *
 * Sidebar navigation uses router.push with a consistent internal pathname
 * so Next.js treats all transitions as shallow (same page component).
 * Also exposes `highlightBatchId` for scroll-to-batch + yellow flash.
 */
import { useCallback } from "react";
import { useRouter } from "next/router";

export const ALL_RUNS_ID = "all-runs" as const;
export const EXTERNAL_SET_PREFIX = "external:" as const;

/** Checks if a selection identifier represents an external set. */
export function isExternalSetSelection(slug: string): boolean {
  return slug.startsWith(EXTERNAL_SET_PREFIX);
}

/** Extracts the scenarioSetId from an external set selection identifier. */
export function extractExternalSetId(slug: string): string {
  return slug.slice(EXTERNAL_SET_PREFIX.length);
}

/** Creates a selection identifier for an external set. */
export function toExternalSetSelection(scenarioSetId: string): string {
  return `${EXTERNAL_SET_PREFIX}${scenarioSetId}`;
}

type SuiteRouting = {
  selectedSuiteSlug: string | typeof ALL_RUNS_ID | null;
  navigateToSuite: (slug: string | typeof ALL_RUNS_ID) => void;
  highlightBatchId: string | null;
};

export function useSuiteRouting(): SuiteRouting {
  const router = useRouter();

  const { selectedSuiteSlug, highlightBatchId } = deriveFromPath({
    isReady: router.isReady,
    pathname: router.pathname,
    query: router.query,
  });

  const projectSlug = router.query.project as string | undefined;

  const navigateToSuite = useCallback(
    (slug: string | typeof ALL_RUNS_ID) => {
      if (!projectSlug) return;

      // Preserve date params so period survives navigation
      const dateParams: Record<string, string> = {};
      if (typeof router.query.startDate === "string") dateParams.startDate = router.query.startDate;
      if (typeof router.query.endDate === "string") dateParams.endDate = router.query.endDate;

      const dateQueryString = Object.entries(dateParams)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&");

      let displayUrl: string;
      let internalPathname: string;
      let internalQuery: Record<string, string>;

      if (slug === ALL_RUNS_ID) {
        displayUrl = `/${projectSlug}/simulations`;
        internalPathname = "/[project]/simulations";
        internalQuery = { project: projectSlug, ...dateParams };
      } else if (isExternalSetSelection(slug)) {
        const setId = extractExternalSetId(slug);
        displayUrl = `/${projectSlug}/simulations/${setId}`;
        internalPathname = "/[project]/simulations/[scenarioSetId]";
        internalQuery = { project: projectSlug, scenarioSetId: setId, ...dateParams };
      } else {
        displayUrl = `/${projectSlug}/simulations/run-plans/${slug}`;
        internalPathname = "/[project]/simulations/run-plans/[suiteSlug]";
        internalQuery = { project: projectSlug, suiteSlug: slug, ...dateParams };
      }

      const asUrl = dateQueryString ? `${displayUrl}?${dateQueryString}` : displayUrl;

      // Use router.push so Next.js knows about the new pathname/query.
      // Even though the internal pathname differs between routes, Next.js
      // handles the transition correctly since all page files render the
      // same SimulationsPage component.
      void router.push(
        { pathname: internalPathname, query: internalQuery },
        asUrl,
      );
    },
    [router, projectSlug],
  );

  return { selectedSuiteSlug, navigateToSuite, highlightBatchId };
}

/** Determines which selection is active from the current route. */
export function deriveFromPath({
  isReady,
  pathname,
  query,
}: {
  isReady: boolean;
  pathname: string;
  query: Record<string, string | string[] | undefined>;
}): { selectedSuiteSlug: string | typeof ALL_RUNS_ID | null; highlightBatchId: string | null } {
  if (!isReady) return { selectedSuiteSlug: null, highlightBatchId: null };

  // /simulations/run-plans/[suiteSlug] or /simulations/run-plans/[suiteSlug]/[batchId]
  if (pathname.includes("/simulations/run-plans/")) {
    const suiteSlug = asString(query.suiteSlug);
    const batchId = asString(query.batchId);
    return {
      selectedSuiteSlug: suiteSlug ?? ALL_RUNS_ID,
      highlightBatchId: batchId ?? null,
    };
  }

  // /simulations/[externalSetSlug]/[batchId] or /simulations/[scenarioSetId]/[batchRunId]
  const externalSetSlug = asString(query.externalSetSlug) ?? asString(query.scenarioSetId);
  if (externalSetSlug) {
    const batchId = asString(query.batchId) ?? asString(query.batchRunId);
    return {
      selectedSuiteSlug: toExternalSetSelection(externalSetSlug),
      highlightBatchId: batchId ?? null,
    };
  }

  // /simulations (base path) → All Runs
  return { selectedSuiteSlug: ALL_RUNS_ID, highlightBatchId: null };
}

function asString(val: string | string[] | undefined): string | undefined {
  if (Array.isArray(val)) return val[0];
  return val;
}
