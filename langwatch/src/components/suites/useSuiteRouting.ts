/**
 * Hook for URL-based suite routing.
 *
 * Reads suite slug from the `?suite=` query parameter and provides
 * navigation helpers for shallow client-side transitions.
 * Also supports `?externalSet=<scenarioSetId>` for external SDK/CI sets.
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
};

export function useSuiteRouting(): SuiteRouting {
  const router = useRouter();

  const selectedSuiteSlug = deriveSelectedSuiteSlug({
    isReady: router.isReady,
    suiteParam: router.query.suite,
    externalSetParam: router.query.externalSet,
  });

  const projectSlug = router.query.project as string | undefined;

  const navigateToSuite = useCallback(
    (slug: string | typeof ALL_RUNS_ID) => {
      if (!projectSlug) return;

      const basePath = `/${projectSlug}/simulations/suites`;

      // Preserve date params so period survives navigation
      const dateParams: Record<string, string> = {};
      if (typeof router.query.startDate === "string") dateParams.startDate = router.query.startDate;
      if (typeof router.query.endDate === "string") dateParams.endDate = router.query.endDate;

      const dateQueryString = Object.entries(dateParams)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&");

      if (isExternalSetSelection(slug)) {
        const setId = extractExternalSetId(slug);
        const qs = `externalSet=${encodeURIComponent(setId)}${dateQueryString ? `&${dateQueryString}` : ""}`;
        void router.push(
          {
            pathname: "/[project]/simulations/suites",
            query: { project: projectSlug, externalSet: setId, ...dateParams },
          },
          `${basePath}?${qs}`,
          { shallow: true },
        );
        return;
      }

      const selectionQs = slug === ALL_RUNS_ID ? "" : `suite=${slug}`;
      const qs = [selectionQs, dateQueryString].filter(Boolean).join("&");
      const asUrl = qs ? `${basePath}?${qs}` : basePath;

      void router.push(
        {
          pathname: "/[project]/simulations/suites",
          query:
            slug === ALL_RUNS_ID
              ? { project: projectSlug, ...dateParams }
              : { project: projectSlug, suite: slug, ...dateParams },
        },
        asUrl,
        { shallow: true },
      );
    },
    [router, projectSlug],
  );

  return { selectedSuiteSlug, navigateToSuite };
}

function deriveSelectedSuiteSlug({
  isReady,
  suiteParam,
  externalSetParam,
}: {
  isReady: boolean;
  suiteParam: string | string[] | undefined;
  externalSetParam: string | string[] | undefined;
}): string | typeof ALL_RUNS_ID | null {
  if (!isReady) return null;

  if (externalSetParam) {
    const setId = Array.isArray(externalSetParam)
      ? externalSetParam[0]
      : externalSetParam;
    if (setId) return toExternalSetSelection(setId);
  }

  if (!suiteParam) return ALL_RUNS_ID;

  const slug = Array.isArray(suiteParam) ? suiteParam[0] : suiteParam;
  return slug ?? ALL_RUNS_ID;
}
