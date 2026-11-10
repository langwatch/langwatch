/**
 * What an organization's flags say about LangWatch's hosted judge: routed (ADR-190 decision 8) or
 * switched off. Each is read for the project within its organization so an organization rule
 * applies.
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */
import type { FeatureFlagApi, FeatureFlagKey } from "@langwatch/feature-flag-contract";
import { INSTANT_EVALS_HOSTED_DISABLED_FLAG } from "@langwatch/instant-eval-judge-contract";
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

  readonly isRouted = ({ projectId }: { projectId: string }): Promise<boolean> =>
    this.isOrganizationFlagged({ flagKey: "release_instant_evals_judge_router", projectId });

  readonly isHostedOff = ({ projectId }: { projectId: string }): Promise<boolean> =>
    this.isOrganizationFlagged({ flagKey: INSTANT_EVALS_HOSTED_DISABLED_FLAG, projectId });

  /** A project with no organization reads as off: no organization rule could name it. */
  private async isOrganizationFlagged({
    flagKey,
    projectId,
  }: {
    flagKey: FeatureFlagKey;
    projectId: string;
  }): Promise<boolean> {
    const organizationId = await this.projects.findOrganizationId(projectId);
    if (!organizationId) return false;
    return this.flags.isEnabled(flagKey, { kind: "project", projectId, organizationId });
  }
}
