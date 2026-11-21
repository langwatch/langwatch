/**
 * What an organization's flags say about LangWatch's hosted judge: routed (ADR-190 decision 8) or
 * switched off. Each is read for the project within its organization, which the judge call looks
 * up once and shares with the kept-results flag (ADR-189 section 5).
 * @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */
import type { FeatureFlagApi, FeatureFlagKey } from "@langwatch/feature-flag-contract";
import { INSTANT_EVALS_HOSTED_DISABLED_FLAG } from "@langwatch/instant-eval-judge-contract";

import type { EvaluationJudgeRouting } from "./evaluation-judging.service.ts";

export class EvaluationJudgeRoutingService implements EvaluationJudgeRouting {
  static create(deps: { flags: Pick<FeatureFlagApi, "isEnabled"> }): EvaluationJudgeRoutingService {
    return new EvaluationJudgeRoutingService(deps.flags);
  }

  private constructor(private readonly flags: Pick<FeatureFlagApi, "isEnabled">) {}

  readonly isRouted = (input: {
    projectId: string;
    organizationId: string | undefined;
  }): Promise<boolean> =>
    this.isOrganizationFlagged({ flagKey: "release_instant_evals_judge_router", ...input });

  readonly isHostedOff = (input: {
    projectId: string;
    organizationId: string | undefined;
  }): Promise<boolean> =>
    this.isOrganizationFlagged({ flagKey: INSTANT_EVALS_HOSTED_DISABLED_FLAG, ...input });

  /** A project with no organization reads as off: no organization rule could name it. */
  private async isOrganizationFlagged({
    flagKey,
    projectId,
    organizationId,
  }: {
    flagKey: FeatureFlagKey;
    projectId: string;
    organizationId: string | undefined;
  }): Promise<boolean> {
    if (!organizationId) return false;
    return this.flags.isEnabled(flagKey, { kind: "project", projectId, organizationId });
  }
}
