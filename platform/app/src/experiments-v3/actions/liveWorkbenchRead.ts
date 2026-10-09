import type { EvaluationsV3State } from "../types";
import {
  type ProjectedWorkbenchState,
  projectWorkbenchState,
  type TargetNames,
} from "./projection";

/**
 * The workbench slice a live read projects. The store's own state satisfies it,
 * which is the point: the answer is the LIVE board, unsaved prompt drafts and
 * in-memory results included, which the saved copy cannot show.
 */
export type LiveWorkbenchSource = Pick<
  EvaluationsV3State,
  "name" | "datasets" | "activeDatasetId" | "evaluators" | "targets" | "results"
> & {
  experimentId?: string;
  experimentSlug?: string;
  workbenchVersion?: number;
};

/** What `workbench.getState` answers from an open page. */
export type LiveWorkbenchRead = ProjectedWorkbenchState & {
  source: "live";
  version?: number;
};

/**
 * The workbench as the agent should read it from an open page.
 *
 * `source` mirrors the backend fallback's marker, so the agent always knows
 * whether it read the live page or the saved document.
 *
 * Pure, and free of React: the page calls it with the store's state and so does
 * a headless stand-in for the page, which is what keeps the two answering the
 * same shape. `targetNames` is the caller's, because a prompt handle only
 * exists in the database and this projection reaches nothing.
 */
export const readLiveWorkbench = ({
  state,
  includeResults,
  targetNames,
}: {
  state: LiveWorkbenchSource;
  includeResults?: boolean;
  /** Column names as the caller resolved them, keyed by target id. */
  targetNames?: TargetNames;
}): LiveWorkbenchRead => {
  const identity: { experimentId?: string; experimentSlug?: string } = {};
  if (state.experimentId) identity.experimentId = state.experimentId;
  if (state.experimentSlug) identity.experimentSlug = state.experimentSlug;

  const withResults: { results?: LiveWorkbenchSource["results"] } = {};
  if (includeResults !== false) withResults.results = state.results;

  const projection = projectWorkbenchState({
    state: {
      name: state.name,
      datasets: state.datasets,
      activeDatasetId: state.activeDatasetId,
      evaluators: state.evaluators,
      targets: state.targets,
      ...identity,
    },
    ...(targetNames ? { targetNames } : {}),
    ...withResults,
  });

  const version: { version?: number } = {};
  if (state.workbenchVersion !== undefined) {
    version.version = state.workbenchVersion;
  }

  return { source: "live", ...version, ...projection };
};
