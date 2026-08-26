/**
 * Path routing for the single Agent Testing page.
 *
 * Every Agent Testing address is served by one catch-all page file
 * ([[...path]].tsx) and every move inside it is a shallow push, so the page
 * never remounts and the live-run subscription it holds is never dropped.
 *
 * Addresses:
 *   /agent-testing                                  Test cases, all cases
 *   /agent-testing/suites/:suiteSlug                Test cases, one suite
 *   /agent-testing/external/:setId                  Test cases, external set
 *   /agent-testing/results                          Results, run plans list
 *   /agent-testing/results/:planSlug                Results, one plan
 *   /agent-testing/results/:planSlug/:batchRunId    Results, one run
 *
 * @see specs/features/agent-testing/page-structure.feature
 */
import { useCallback, useMemo } from "react";
import { survivesSelectionChange } from "~/components/suites/useSuiteRouting";
import { useRouter } from "~/utils/compat/next-router";

/** The catch-all page every Agent Testing address is pushed into. */
export const AGENT_TESTING_PATHNAME = "/[project]/agent-testing/[[...path]]";

export const RESULTS_SEGMENT = "results" as const;
export const SUITES_SEGMENT = "suites" as const;
export const EXTERNAL_SEGMENT = "external" as const;

/** The plan slug of the synthesized plan that holds the one-off runs. */
export const ONE_OFF_RUNS_PLAN_SLUG = "one-off-runs" as const;

export type AgentTestingTab = "cases" | "results";

export type AgentTestingSelection =
  | { kind: "all" }
  | { kind: "suite"; slug: string }
  | { kind: "external"; setId: string };

export type AgentTestingRoutingState = {
  tab: AgentTestingTab;
  selection: AgentTestingSelection;
  planSlug: string | null;
  batchRunId: string | null;
};

export type AgentTestingRouting = AgentTestingRoutingState & {
  /**
   * False until the router reports the address. The page reads the address
   * for its whole state, so a surface that would claim "nothing here" holds
   * its render until this turns true.
   */
  isReady: boolean;
  setTab: (tab: AgentTestingTab) => void;
  selectSuite: (selection: AgentTestingSelection) => void;
  selectPlan: (planSlug: string | null) => void;
  selectRun: (batchRunId: string | null) => void;
};

const ALL_CASES: AgentTestingSelection = { kind: "all" };

const DEFAULT_STATE: AgentTestingRoutingState = {
  tab: "cases",
  selection: ALL_CASES,
  planSlug: null,
  batchRunId: null,
};

/**
 * The address segments, without anything that is a query string leaking into
 * them. The simulations catch-all needs the same guard.
 */
function cleanSegments(path: string | string[] | undefined): string[] {
  const raw = Array.isArray(path) ? path : path ? [path] : [];
  return raw.filter(
    (segment) => segment && !segment.startsWith("?") && !segment.includes("="),
  );
}

/**
 * The state an address holds. Pure and exported so the address rules are
 * testable without a router.
 */
export function deriveAgentTestingRouting(
  path: string | string[] | undefined,
): AgentTestingRoutingState {
  const segments = cleanSegments(path);

  if (segments.length === 0) return DEFAULT_STATE;

  if (segments[0] === RESULTS_SEGMENT) {
    return {
      tab: "results",
      selection: ALL_CASES,
      planSlug: segments[1] ?? null,
      batchRunId: segments[2] ?? null,
    };
  }

  if (segments[0] === SUITES_SEGMENT && segments[1]) {
    return {
      ...DEFAULT_STATE,
      selection: { kind: "suite", slug: segments[1] },
    };
  }

  if (segments[0] === EXTERNAL_SEGMENT && segments[1]) {
    return {
      ...DEFAULT_STATE,
      selection: { kind: "external", setId: segments[1] },
    };
  }

  return DEFAULT_STATE;
}

/** The address segments a state is written as. Pure, and the inverse of the above. */
export function buildAgentTestingSegments(
  state: AgentTestingRoutingState,
): string[] {
  if (state.tab === "results") {
    if (!state.planSlug) return [RESULTS_SEGMENT];
    if (!state.batchRunId) return [RESULTS_SEGMENT, state.planSlug];
    return [RESULTS_SEGMENT, state.planSlug, state.batchRunId];
  }

  if (state.selection.kind === "suite") {
    return [SUITES_SEGMENT, state.selection.slug];
  }
  if (state.selection.kind === "external") {
    return [EXTERNAL_SEGMENT, state.selection.setId];
  }
  return [];
}

/** Extracts the segments under /agent-testing from the address as it is shown. */
export function extractAgentTestingPath(asPath: string): string[] | undefined {
  const pathOnly = asPath.split("?")[0]?.split("#")[0] ?? "";
  const match = pathOnly.match(/\/agent-testing\/(.+?)\/?$/);
  if (!match?.[1]) return undefined;
  return match[1].split("/").filter(Boolean);
}

type RouterQuery = Record<string, string | string[] | undefined>;

/** The params that follow a selection, keyed as the address holds them. */
function carriedParamsOf(
  query: RouterQuery,
): Record<string, string | string[]> {
  const carried: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || !survivesSelectionChange(key)) continue;
    carried[key] = value;
  }
  return carried;
}

/** The params written back as a query string. */
function toQueryString(params: Record<string, string | string[]>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
    } else {
      search.set(key, value);
    }
  }
  return search.toString();
}

/**
 * The route and the address one state is pushed as. Pure, so the whole
 * address contract can be read in one place.
 */
export function buildAgentTestingPush({
  projectSlug,
  state,
  query,
}: {
  projectSlug: string;
  state: AgentTestingRoutingState;
  query: RouterQuery;
}): {
  route: { pathname: string; query: Record<string, string | string[]> };
  address: string;
} {
  const carried = carriedParamsOf(query);
  const segments = buildAgentTestingSegments(state);
  const path =
    segments.length > 0
      ? `/${projectSlug}/agent-testing/${segments.join("/")}`
      : `/${projectSlug}/agent-testing`;
  const queryString = toQueryString(carried);

  return {
    route: {
      pathname: AGENT_TESTING_PATHNAME,
      query: {
        project: projectSlug,
        ...(segments.length > 0 ? { path: segments } : {}),
        ...carried,
      },
    },
    address: queryString ? `${path}?${queryString}` : path,
  };
}

export function useAgentTestingRouting(): AgentTestingRouting {
  const router = useRouter();
  const projectSlug = router.query.project as string | undefined;

  // Read the address itself rather than query.path: a shallow push into a
  // catch-all route does not always refresh query.path.
  const path = router.query.path ?? extractAgentTestingPath(router.asPath);
  const isReady = router.isReady;

  const state = useMemo(
    () => (isReady ? deriveAgentTestingRouting(path) : DEFAULT_STATE),
    [isReady, path],
  );

  const push = useCallback(
    (next: AgentTestingRoutingState) => {
      if (!projectSlug) return;

      const { route, address } = buildAgentTestingPush({
        projectSlug,
        state: next,
        query: router.query,
      });

      void router.push(route, address, { shallow: true });
    },
    [router, projectSlug],
  );

  const setTab = useCallback(
    (tab: AgentTestingTab) => {
      // Each tab opens on its own root: the Results tab drops the plan and the
      // run it held, and the Test cases tab opens on all cases.
      push({ ...DEFAULT_STATE, tab });
    },
    [push],
  );

  const selectSuite = useCallback(
    (selection: AgentTestingSelection) => {
      push({ ...DEFAULT_STATE, tab: "cases", selection });
    },
    [push],
  );

  const selectPlan = useCallback(
    (planSlug: string | null) => {
      push({ ...DEFAULT_STATE, tab: "results", planSlug });
    },
    [push],
  );

  const selectRun = useCallback(
    (batchRunId: string | null) => {
      push({
        ...DEFAULT_STATE,
        tab: "results",
        planSlug: state.planSlug,
        batchRunId,
      });
    },
    [push, state.planSlug],
  );

  return {
    ...state,
    isReady,
    setTab,
    selectSuite,
    selectPlan,
    selectRun,
  };
}
