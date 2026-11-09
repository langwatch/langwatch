/**
 * Whether a project's Instant Evals judges go through the judge router: the organization's
 * `release_instant_evals_judge_router` flag, read for the project within its organization so an
 * organization rule applies (ADR-190 decision 8).
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { EvaluationJudgeRouting } from "./evaluation-judging.service.ts";

export class EvaluationJudgeRoutingService implements EvaluationJudgeRouting {
  static create(deps: {
    flags: Pick<FeatureFlagApi, "isEnabled">;
    projects: Pick<ProjectApi, "findOrganizationId">;
  }): EvaluationJudgeRoutingService {
    return new EvaluationJudgeRoutingService(deps.flags, deps.projects);
  }

  private constructor(
    private readonly flags: Pick<FeatureFlagApi, "isEnabled">,
    private readonly projects: Pick<ProjectApi, "findOrganizationId">,
  ) {}

  /** A project with no organization is never routed: no organization rule could name it. */
  readonly isRouted = async ({ projectId }: { projectId: string }): Promise<boolean> => {
    const organizationId = await this.projects.findOrganizationId(projectId);
    if (!organizationId) return false;
    return this.flags.isEnabled("release_instant_evals_judge_router", {
      kind: "project",
      projectId,
      organizationId,
    });
  };
}
