import { isAggregateProjectKind } from "~/server/app-layer/projects/project-kinds";

/** Which parts of the project navigation a project of this kind offers. */
export interface ProjectNavigation {
  home: boolean;
  /** Analytics and Traces: every project that can be opened has these. */
  observe: true;
  onlineEvaluations: boolean;
  /** Agent testing or simulations, Experiments, Annotations. */
  test: boolean;
  /** Prompts, datasets, evaluators, workflows, automations and the rest. */
  build: boolean;
}

const EVERYTHING: ProjectNavigation = {
  home: true,
  observe: true,
  onlineEvaluations: true,
  test: true,
  build: true,
};

/**
 * ADR-144 decision 8: an aggregate project is read only in v1. It owns no
 * traces and runs nothing, so its navigation is Analytics and Traces and
 * nothing else: no home page with setup steps for a key it does not have, no
 * Online Evals (no monitor can be created on it), no Test and no Build.
 * Every other kind keeps the whole menu.
 */
export function projectNavigation(
  kind: string | null | undefined,
): ProjectNavigation {
  if (!isAggregateProjectKind(kind)) return EVERYTHING;
  return {
    home: false,
    observe: true,
    onlineEvaluations: false,
    test: false,
    build: false,
  };
}
