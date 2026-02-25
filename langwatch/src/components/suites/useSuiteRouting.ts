/**
 * Hook for URL-based suite routing.
 *
 * Reads suite slug from the `?suite=` query parameter and provides
 * navigation helpers for shallow client-side transitions.
 */
import { useCallback } from "react";
import { useRouter } from "next/router";

export const ALL_RUNS_ID = "all-runs" as const;

type SuiteRouting = {
  selectedSuiteSlug: string | typeof ALL_RUNS_ID | null;
  navigateToSuite: (slug: string | typeof ALL_RUNS_ID) => void;
};

export function useSuiteRouting(): SuiteRouting {
  const router = useRouter();

  const selectedSuiteSlug = deriveSelectedSuiteSlug({
    isReady: router.isReady,
    suiteParam: router.query.suite,
  });

  const projectSlug = router.query.project as string | undefined;

  const navigateToSuite = useCallback(
    (slug: string | typeof ALL_RUNS_ID) => {
      if (!projectSlug) return;

      const basePath = `/${projectSlug}/simulations/suites`;
      const asUrl =
        slug === ALL_RUNS_ID ? basePath : `${basePath}?suite=${slug}`;

      void router.push(
        {
          pathname: "/[project]/simulations/suites",
          query:
            slug === ALL_RUNS_ID
              ? { project: projectSlug }
              : { project: projectSlug, suite: slug },
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
}: {
  isReady: boolean;
  suiteParam: string | string[] | undefined;
}): string | typeof ALL_RUNS_ID | null {
  if (!isReady) return null;

  if (!suiteParam) return ALL_RUNS_ID;

  const slug = Array.isArray(suiteParam) ? suiteParam[0] : suiteParam;
  return slug ?? ALL_RUNS_ID;
}
