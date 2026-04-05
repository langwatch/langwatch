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

      // Use shallow routing to avoid full page transitions — all page files
      // render the same SimulationsPage component, so we just need the URL
      // to update and the component to re-derive state from the new path.
      // We use window.history + router state to achieve this cleanly.

      if (slug === ALL_RUNS_ID) {
        const displayUrl = `/${projectSlug}/simulations`;
        const asUrl = dateQueryString ? `${displayUrl}?${dateQueryString}` : displayUrl;
        void router.push(
          { pathname: "/[project]/simulations", query: { project: projectSlug, ...dateParams } },
          asUrl,
          { shallow: true },
        );
        return;
      }

      if (isExternalSetSelection(slug)) {
        const setId = extractExternalSetId(slug);
        const displayUrl = `/${projectSlug}/simulations/${setId}`;
        const asUrl = dateQueryString ? `${displayUrl}?${dateQueryString}` : displayUrl;
        void router.push(
          { pathname: "/[project]/simulations/[scenarioSetId]", query: { project: projectSlug, scenarioSetId: setId, ...dateParams } },
          asUrl,
          { shallow: true },
        );
        return;
      }

      // Suite slug
      const displayUrl = `/${projectSlug}/simulations/run-plans/${slug}`;
      const asUrl = dateQueryString ? `${displayUrl}?${dateQueryString}` : displayUrl;
      void router.push(
        { pathname: "/[project]/simulations/run-plans/[suiteSlug]", query: { project: projectSlug, suiteSlug: slug, ...dateParams } },
        asUrl,
        { shallow: true },
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
  // These are the dynamic catch-all patterns for external sets
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
