/**
 * Hook for path-based suite routing.
 *
 * All simulation sub-paths are handled by a single catch-all page file
 * ([[...path]].tsx), so sidebar navigation uses shallow routing — no
 * full page transitions, no remounting, no skeleton flicker.
 *
 * Derives the active selection from router.query.path:
 *   []                            → All Runs
 *   ["run-plans", slug]           → Suite detail
 *   ["run-plans", slug, batchId]  → Suite + highlight batch
 *   [setSlug]                     → External set
 *   [setSlug, batchId]            → External set + highlight batch
 */
import { useCallback } from "react";
import { useRouter } from "~/utils/compat/next-router";

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

  // Derive from asPath (actual URL) rather than query.path, because
  // shallow routing on catch-all [[...path]] may not update query.path
  // consistently across Next.js versions.
  const { selectedSuiteSlug, highlightBatchId } = deriveFromPath({
    isReady: router.isReady,
    path: router.query.path ?? extractPathFromAsPath(router.asPath),
  });

  const projectSlug = router.query.project as string | undefined;

  const navigateToSuite = useCallback(
    (slug: string | typeof ALL_RUNS_ID) => {
      if (!projectSlug) return;

      // Preserve date params so period survives navigation
      const dateParams: Record<string, string> = {};
      if (typeof router.query.startDate === "string") dateParams.startDate = router.query.startDate;
      if (typeof router.query.endDate === "string") dateParams.endDate = router.query.endDate;

      let pathSegments: string[];
      if (slug === ALL_RUNS_ID) {
        pathSegments = [];
      } else if (isExternalSetSelection(slug)) {
        pathSegments = [extractExternalSetId(slug)];
      } else {
        pathSegments = ["run-plans", slug];
      }

      const displayPath = pathSegments.length > 0
        ? `/${projectSlug}/simulations/${pathSegments.join("/")}`
        : `/${projectSlug}/simulations`;

      const dateQueryString = Object.entries(dateParams)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&");
      const asUrl = dateQueryString ? `${displayPath}?${dateQueryString}` : displayPath;

      // All routes are handled by the same [[...path]] page, so shallow works
      void router.push(
        {
          pathname: "/[project]/simulations/[[...path]]",
          query: {
            project: projectSlug,
            ...(pathSegments.length > 0 ? { path: pathSegments } : {}),
            ...dateParams,
          },
        },
        asUrl,
        { shallow: true },
      );
    },
    [router, projectSlug],
  );

  return { selectedSuiteSlug, navigateToSuite, highlightBatchId };
}

/** Determines which selection is active from the catch-all path segments. */
export function deriveFromPath({
  isReady,
  path,
}: {
  isReady: boolean;
  path: string | string[] | undefined;
}): { selectedSuiteSlug: string | typeof ALL_RUNS_ID | null; highlightBatchId: string | null } {
  if (!isReady) return { selectedSuiteSlug: null, highlightBatchId: null };

  const segments = Array.isArray(path) ? path : path ? [path] : [];

  // [] → All Runs
  if (segments.length === 0) {
    return { selectedSuiteSlug: ALL_RUNS_ID, highlightBatchId: null };
  }

  // ["run-plans", slug] or ["run-plans", slug, batchId]
  if (segments[0] === "run-plans" && segments.length >= 2) {
    return {
      selectedSuiteSlug: segments[1]!,
      highlightBatchId: segments[2] ?? null,
    };
  }

  // [setSlug] or [setSlug, batchId]
  return {
    selectedSuiteSlug: toExternalSetSelection(segments[0]!),
    highlightBatchId: segments[1] ?? null,
  };
}

/** Extract path segments from asPath (e.g., "/project/simulations/run-plans/slug" → ["run-plans", "slug"]) */
function extractPathFromAsPath(asPath: string): string[] | undefined {
  const match = asPath.match(/\/simulations(?:\/(.+?))?(?:\?|$)/);
  if (!match?.[1]) return undefined;
  return match[1].split("/");
}
