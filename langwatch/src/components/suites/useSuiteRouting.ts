/**
 * Hook for URL-based suite routing.
 *
 * Reads suite ID from the optional catch-all route `[[...suiteId]]`
 * and provides navigation helpers for shallow client-side transitions.
 */
import { useCallback } from "react";
import { useRouter } from "next/router";

export const ALL_RUNS_ID = "all-runs" as const;

type SuiteRouting = {
  selectedSuiteId: string | typeof ALL_RUNS_ID | null;
  navigateToSuite: (id: string | typeof ALL_RUNS_ID) => void;
};

export function useSuiteRouting(): SuiteRouting {
  const router = useRouter();

  const selectedSuiteId = deriveSelectedSuiteId({
    isReady: router.isReady,
    suiteIdParam: router.query.suiteId,
  });

  const projectSlug = router.query.project as string | undefined;
  const { push } = router;

  const navigateToSuite = useCallback(
    (id: string | typeof ALL_RUNS_ID) => {
      if (!projectSlug) return;
      const basePath = `/${projectSlug}/simulations/suites`;
      const path = id === ALL_RUNS_ID ? basePath : `${basePath}/${id}`;
      void push(path, undefined, { shallow: true });
    },
    [push, projectSlug],
  );

  return { selectedSuiteId, navigateToSuite };
}

function deriveSelectedSuiteId({
  isReady,
  suiteIdParam,
}: {
  isReady: boolean;
  suiteIdParam: string | string[] | undefined;
}): string | typeof ALL_RUNS_ID | null {
  if (!isReady) return null;

  if (!suiteIdParam || (Array.isArray(suiteIdParam) && suiteIdParam.length === 0)) {
    return ALL_RUNS_ID;
  }

  const id = Array.isArray(suiteIdParam) ? suiteIdParam[0] : suiteIdParam;
  return id ?? ALL_RUNS_ID;
}
