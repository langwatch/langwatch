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
 * Sidebar navigation uses window.history.pushState to avoid full Next.js
 * page transitions (all page files render the same SimulationsPage component).
 * Also exposes `highlightBatchId` for scroll-to-batch + yellow flash.
 */
import { useCallback, useEffect, useState } from "react";
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
  const projectSlug = router.query.project as string | undefined;

  // Derive initial state from the router (covers hard navigations / page loads)
  const initial = deriveFromPath({
    isReady: router.isReady,
    pathname: router.pathname,
    query: router.query,
  });

  // Local state for the selection — updated by sidebar clicks via pushState,
  // avoids full Next.js page transitions between different page files.
  const [selection, setSelection] = useState(initial);

  // Sync local state when router changes (hard navigation, popstate, initial load)
  useEffect(() => {
    const derived = deriveFromPath({
      isReady: router.isReady,
      pathname: router.pathname,
      query: router.query,
    });
    setSelection(derived);
  }, [router.isReady, router.pathname, router.asPath, router.query]);

  // Listen for browser back/forward to re-derive selection
  useEffect(() => {
    const handlePopState = () => {
      // On popstate, Next.js router will update — the effect above handles it.
      // But for pushState-based URLs that Next.js doesn't know about, we need
      // to parse from window.location.
      const parsed = parseFromUrl(window.location.pathname);
      if (parsed) {
        setSelection(parsed);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigateToSuite = useCallback(
    (slug: string | typeof ALL_RUNS_ID) => {
      if (!projectSlug) return;

      // Preserve date params so period survives navigation
      const searchParams = new URLSearchParams(window.location.search);
      const dateParams: Record<string, string> = {};
      const startDate = searchParams.get("startDate");
      const endDate = searchParams.get("endDate");
      if (startDate) dateParams.startDate = startDate;
      if (endDate) dateParams.endDate = endDate;

      const dateQueryString = new URLSearchParams(dateParams).toString();

      let displayUrl: string;
      let newSelection: { selectedSuiteSlug: string; highlightBatchId: string | null };

      if (slug === ALL_RUNS_ID) {
        displayUrl = `/${projectSlug}/simulations`;
        newSelection = { selectedSuiteSlug: ALL_RUNS_ID, highlightBatchId: null };
      } else if (isExternalSetSelection(slug)) {
        const setId = extractExternalSetId(slug);
        displayUrl = `/${projectSlug}/simulations/${setId}`;
        newSelection = { selectedSuiteSlug: toExternalSetSelection(setId), highlightBatchId: null };
      } else {
        displayUrl = `/${projectSlug}/simulations/run-plans/${slug}`;
        newSelection = { selectedSuiteSlug: slug, highlightBatchId: null };
      }

      const fullUrl = dateQueryString ? `${displayUrl}?${dateQueryString}` : displayUrl;

      // Use pushState to update URL without Next.js page transition
      window.history.pushState(null, "", fullUrl);
      setSelection(newSelection);

      // Emit router event so analytics (PostHog), activity tracker, etc. still fire
      router.events.emit("routeChangeComplete", fullUrl);
    },
    [projectSlug, router.events],
  );

  return {
    selectedSuiteSlug: selection.selectedSuiteSlug,
    navigateToSuite,
    highlightBatchId: selection.highlightBatchId,
  };
}

/** Determines which selection is active from the current route (Next.js router). */
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

/** Parse selection from a raw URL pathname (for pushState/popstate). */
function parseFromUrl(pathname: string): { selectedSuiteSlug: string; highlightBatchId: string | null } | null {
  // /project/simulations/run-plans/slug/batchId
  const runPlansMatch = pathname.match(/\/simulations\/run-plans\/([^/]+)(?:\/([^/?]+))?/);
  if (runPlansMatch) {
    return {
      selectedSuiteSlug: runPlansMatch[1]!,
      highlightBatchId: runPlansMatch[2] ?? null,
    };
  }

  // /project/simulations/setId/batchId (external set)
  const externalMatch = pathname.match(/\/simulations\/(?!run-plans|scenarios|suites)([^/]+)(?:\/([^/?]+))?/);
  if (externalMatch) {
    return {
      selectedSuiteSlug: toExternalSetSelection(externalMatch[1]!),
      highlightBatchId: externalMatch[2] ?? null,
    };
  }

  // /project/simulations (base)
  if (pathname.match(/\/simulations\/?$/)) {
    return { selectedSuiteSlug: ALL_RUNS_ID, highlightBatchId: null };
  }

  return null;
}

function asString(val: string | string[] | undefined): string | undefined {
  if (Array.isArray(val)) return val[0];
  return val;
}
