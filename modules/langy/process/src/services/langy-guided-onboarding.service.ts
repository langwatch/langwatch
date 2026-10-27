/**
 * The guided onboarding a failed turn is checked against, answered by onboarding, and the fact
 * it is recorded as on langy's own pipeline. @see specs/analytics/posthog-guided-onboarding.feature
 */
import type { GuidedOnboardingTurnFailedEventData } from "@langwatch/langy-contract";
import type { OnboardingApi } from "@langwatch/onboarding-contract";

import type {
  GuidedOnboardingFacts,
  GuidedOnboardingForProject,
  GuidedOnboardingReader,
} from "../eventing/langy-guided-onboarding-turn-failed.subscriber.ts";

/** Sends one failed-turn fact to the `langy_guided_onboarding` pipeline. */
type GuidedOnboardingTurnFailedRecorder = (
  data: GuidedOnboardingTurnFailedEventData,
) => Promise<void>;

export class LangyGuidedOnboardingService implements GuidedOnboardingReader, GuidedOnboardingFacts {
  private constructor(
    private readonly onboarding: Pick<OnboardingApi, "getGuidedStateByProject">,
    private readonly record: GuidedOnboardingTurnFailedRecorder,
  ) {}

  static create(input: {
    onboarding: Pick<OnboardingApi, "getGuidedStateByProject">;
    record: GuidedOnboardingTurnFailedRecorder;
  }): LangyGuidedOnboardingService {
    return new LangyGuidedOnboardingService(input.onboarding, input.record);
  }

  async getByProject({ projectId }: { projectId: string }): Promise<GuidedOnboardingForProject> {
    const guided = await this.onboarding.getGuidedStateByProject({ projectId });

    return {
      organizationId: guided.organizationId,
      conversationId: guided.state.conversationId,
      currentPath: guided.state.currentPath,
      variant: guided.variant,
    };
  }

  recordTurnFailed(data: GuidedOnboardingTurnFailedEventData): Promise<void> {
    return this.record(data);
  }
}
