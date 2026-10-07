import { isAggregateProjectKind } from "~/server/app-layer/projects/project-kinds";

/** Which parts of the project navigation a project of this kind offers. */
export interface ProjectNavigation {
  home: boolean;
  /** The Observe section with Traces: every project that can be opened has it. */
  observe: true;
  /** Analytics, inside the Observe section. */
  analytics: boolean;
  onlineEvaluations: boolean;
  /** Agent testing or simulations, Experiments, Annotations. */
  test: boolean;
  /** Prompts, datasets, evaluators, workflows, automations and the rest. */
  build: boolean;
}

const EVERYTHING: ProjectNavigation = {
  home: true,
  observe: true,
  analytics: true,
  onlineEvaluations: true,
  test: true,
  build: true,
};

/**
 * ADR-144 decision 8: an aggregate project is read only in v1. It owns no
 * traces and runs nothing, so its navigation is Traces and nothing else: no
 * home page with setup steps for a key it does not have, no Analytics (counts
 * across members are not delivered yet, so every card would read zero), no
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
    analytics: false,
    onlineEvaluations: false,
    test: false,
    build: false,
  };
}
