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
import { isOnPlatformSet } from "~/server/scenarios/internal-set-id";
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

/**
 * The URL a simulations path should be sent to instead of rendered, or null to
 * render it as it stands.
 *
 * Everything under /simulations that is not a known shape is read as an
 * external SET slug, so a near-miss URL does not fail — it quietly renders the
 * run history for a set that does not exist, which reads as "your thing isn't
 * here". `/simulations/scenarios/<id>` is the near-miss that matters: the
 * scenario library is a real page one segment away, and a link built by hand
 * (or by an agent) lands on it constantly. Send those to the library with the
 * scenario open rather than to an empty set.
 *
 * Pure and exported so the redirect rules are testable without a router.
 */
export function resolveSimulationsRedirect({
  projectSlug,
  segments,
  query,
}: {
  projectSlug: string;
  segments: string[];
  query: Record<string, unknown>;
}): string | null {
  const base = `/${projectSlug}/simulations`;
  const [first, second, third] = segments;

  // The scenario LIBRARY, not a simulation set. `/simulations/scenarios` itself
  // is a route of its own, so only the near-misses reach here.
  if (first === "scenarios" || first === "scenario") {
    return second
      ? `${base}/scenarios?drawer.open=scenarioEditor&drawer.scenarioId=${encodeURIComponent(second)}`
      : `${base}/scenarios`;
  }

  if (first === "suites") {
    const suite = query.suite;
    const externalSet = query.externalSet;
    if (typeof suite === "string" && suite) return `${base}/run-plans/${suite}`;
    if (typeof externalSet === "string" && externalSet) {
      return `${base}/${externalSet}`;
    }
    return base;
  }

  // /setId/batchId/scenarioRunId → the set + batch, with the run's drawer open.
  if (segments.length === 3 && first !== "run-plans") {
    return `${base}/${first}/${second}?openRun=${third}`;
  }

  return null;
}

/**
 * The query params a simulations address holds that name a place rather than
 * a view. They are read into the Agent Testing path and do not travel as they
 * stand.
 */
const PLACE_PARAMS = new Set([
  "project",
  "path",
  "openRun",
  "suite",
  "externalSet",
]);

/** Drawers the two interfaces name differently for the same thing. */
const DRAWER_NAMES: Record<string, string> = {
  scenarioEditor: "agentTestingCaseEditor",
};

/**
 * The Agent Testing address that shows what a simulations address shows.
 *
 * A saved link, a link the scenario library printed before the project moved
 * to Agent Testing, or one an older CLI derived, all name the v1 page. With
 * the release flag on the project reads Agent Testing, so the v1 page sends
 * the reader here instead of rendering.
 *
 *   /simulations                          /agent-testing/results
 *   /simulations/scenarios[/id]           /agent-testing, the editor open on id
 *   /simulations/suites?suite=slug        /agent-testing/results/slug
 *   /simulations/suites?externalSet=id    /agent-testing/results/external:id
 *   /simulations/run-plans/slug[/batch]   /agent-testing/results/slug[/batch]
 *   /simulations/set[/batch[/run]]        /agent-testing/results/external:set[/batch],
 *                                         the run detail drawer open on run
 *
 * Every other query param travels: the period, the grouping, an open drawer
 * and the tab key of a handoff. The v1 scenario editor drawer becomes the
 * case editor. The platform's own sets are listed under their plans, so an
 * address naming one opens the results list.
 *
 * Pure and exported so the mapping is testable without a router.
 */
export function toAgentTestingAddress({
  projectSlug,
  segments,
  query,
}: {
  projectSlug: string;
  segments: string[];
  query: Record<string, unknown>;
}): string {
  const params = travellingParams(query);
  const place = placeOf({ segments: cleanSegments(segments), query });
  if (place.scenarioId) {
    params.set("drawer.open", "agentTestingCaseEditor");
    params.set("drawer.scenarioId", place.scenarioId);
  }
  const runId = place.runId ?? stringParam(query.openRun);
  if (runId) {
    params.set("drawer.open", "scenarioRunDetail");
    params.set("drawer.scenarioRunId", runId);
  }

  const path = [`/${projectSlug}/agent-testing`, ...place.segments].join("/");
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

/**
 * Where a simulations address points, as Agent Testing segments plus the
 * scenario or the run it wants open in a drawer.
 */
type AgentTestingPlace = {
  segments: string[];
  scenarioId?: string;
  runId?: string;
};

const RESULTS = "results";

/** The address segments, without a query string that leaked into them. */
function cleanSegments(segments: string[]): string[] {
  return segments.filter(
    (segment) => segment && !segment.startsWith("?") && !segment.includes("="),
  );
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function placeOf({
  segments,
  query,
}: {
  segments: string[];
  query: Record<string, unknown>;
}): AgentTestingPlace {
  const [first, second, third] = segments;
  if (!first) return { segments: [RESULTS] };
  if (first === "scenarios" || first === "scenario") {
    return { segments: [], scenarioId: second };
  }
  if (first === "suites") return suitesPlace(query);
  if (first === "run-plans")
    return runPlanPlace({ slug: second, batch: third });
  return setPlace({ setId: first, batch: second, run: third });
}

/** The legacy /suites address named its suite or its set in the query. */
function suitesPlace(query: Record<string, unknown>): AgentTestingPlace {
  const suite = stringParam(query.suite);
  if (suite) return { segments: [RESULTS, suite] };
  const externalSet = stringParam(query.externalSet);
  if (externalSet) {
    return { segments: [RESULTS, `${EXTERNAL_SET_PREFIX}${externalSet}`] };
  }
  return { segments: [RESULTS] };
}

function runPlanPlace({
  slug,
  batch,
}: {
  slug: string | undefined;
  batch: string | undefined;
}): AgentTestingPlace {
  if (!slug) return { segments: [RESULTS] };
  return { segments: batch ? [RESULTS, slug, batch] : [RESULTS, slug] };
}

/**
 * A set a code run writes into is a plan of its own. The platform's own sets
 * are listed under their plans, so the results list is where they open.
 */
function setPlace({
  setId,
  batch,
  run,
}: {
  setId: string;
  batch: string | undefined;
  run: string | undefined;
}): AgentTestingPlace {
  if (isOnPlatformSet(setId)) return { segments: [RESULTS], runId: run };
  const plan = `${EXTERNAL_SET_PREFIX}${setId}`;
  return {
    segments: batch ? [RESULTS, plan, batch] : [RESULTS, plan],
    runId: run,
  };
}

/** The query params that describe the view, read for the new address. */
function travellingParams(query: Record<string, unknown>): URLSearchParams {
  const pairs = Object.entries(query)
    .filter(([key]) => !PLACE_PARAMS.has(key))
    .flatMap(([key, value]) =>
      (Array.isArray(value) ? value : [value])
        .filter((one): one is string => typeof one === "string")
        .map((one): [string, string] => [key, one]),
    );
  const params = new URLSearchParams(pairs);
  const drawer = params.get("drawer.open");
  const renamed = drawer ? DRAWER_NAMES[drawer] : undefined;
  if (renamed) params.set("drawer.open", renamed);
  return params;
}

type SuiteRouting = {
  selectedSuiteSlug: string | typeof ALL_RUNS_ID | null;
  navigateToSuite: (slug: string | typeof ALL_RUNS_ID) => void;
  highlightBatchId: string | null;
};

/**
 * Route params, rebuilt from the target selection rather than carried over.
 */
const ROUTE_PARAM_KEYS = new Set(["project", "path"]);

/**
 * Whether a query param carries over when the sidebar selection changes.
 *
 * The date window (`period`, or `startDate` plus `endDate`) and the
 * run-history view state (`groupBy`, `scenarioId`, `passFailStatus`) describe
 * what the user is looking at rather than which set they picked, so they
 * follow the selection. Dropping `period` snapped a widened window back to
 * the 30-day default and hid the older run the user had widened the window to
 * reach. An open drawer is the exception: it holds a run from the set being
 * navigated away from.
 */
export const survivesSelectionChange = (key: string): boolean =>
  !ROUTE_PARAM_KEYS.has(key) && !key.startsWith("drawer");

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

      const carriedParams: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(router.query)) {
        if (value === undefined || !survivesSelectionChange(key)) continue;
        carriedParams[key] = value;
      }

      let pathSegments: string[];
      if (slug === ALL_RUNS_ID) {
        pathSegments = [];
      } else if (isExternalSetSelection(slug)) {
        pathSegments = [extractExternalSetId(slug)];
      } else {
        pathSegments = ["run-plans", slug];
      }

      const displayPath =
        pathSegments.length > 0
          ? `/${projectSlug}/simulations/${pathSegments.join("/")}`
          : `/${projectSlug}/simulations`;

      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(carriedParams)) {
        if (Array.isArray(value)) {
          for (const item of value) search.append(key, item);
        } else {
          search.set(key, value);
        }
      }
      const carriedQueryString = search.toString();
      const asUrl = carriedQueryString
        ? `${displayPath}?${carriedQueryString}`
        : displayPath;

      // All routes are handled by the same [[...path]] page, so shallow works
      void router.push(
        {
          pathname: "/[project]/simulations/[[...path]]",
          query: {
            project: projectSlug,
            ...(pathSegments.length > 0 ? { path: pathSegments } : {}),
            ...carriedParams,
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
}): {
  selectedSuiteSlug: string | typeof ALL_RUNS_ID | null;
  highlightBatchId: string | null;
} {
  if (!isReady) return { selectedSuiteSlug: null, highlightBatchId: null };

  const rawSegments = Array.isArray(path) ? path : path ? [path] : [];
  // Drop segments that are actually query strings leaking in from the URL
  // (e.g. when a redirect fires before the catch-all has stripped "?foo=bar").
  const segments = rawSegments.filter(
    (s) => s && !s.startsWith("?") && !s.includes("="),
  );

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
  const pathOnly = asPath.split("?")[0]?.split("#")[0] ?? "";
  const match = pathOnly.match(/\/simulations\/(.+?)\/?$/);
  if (!match?.[1]) return undefined;
  return match[1].split("/").filter(Boolean);
}
