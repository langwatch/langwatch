/**
 * The guided onboarding a failed turn is checked against, and the event it is tracked as, both
 * answered by onboarding. @see specs/analytics/posthog-guided-onboarding.feature
 */
import { onboardingExperimentProperties, type OnboardingApi } from "@langwatch/onboarding-contract";

import type {
  GuidedOnboardingAnalytics,
  GuidedOnboardingForProject,
  GuidedOnboardingReader,
} from "../eventing/langy-guided-onboarding-turn-failed.subscriber.ts";

export class LangyGuidedOnboardingService
  implements GuidedOnboardingReader, GuidedOnboardingAnalytics
{
  private constructor(
    private readonly onboarding: Pick<
      OnboardingApi,
      "getGuidedStateByProject" | "trackGuidedOnboardingEvent"
    >,
  ) {}

  static create(input: {
    onboarding: Pick<OnboardingApi, "getGuidedStateByProject" | "trackGuidedOnboardingEvent">;
  }): LangyGuidedOnboardingService {
    return new LangyGuidedOnboardingService(input.onboarding);
  }

  async getByProject({ projectId }: { projectId: string }): Promise<GuidedOnboardingForProject> {
    const guided = await this.onboarding.getGuidedStateByProject({ projectId });

    return {
      organizationId: guided.organizationId,
      conversationId: guided.state.conversationId,
      currentPath: guided.state.currentPath,
      experimentProperties: onboardingExperimentProperties(guided.variant),
    };
  }

  track(input: {
    userId: string;
    event: string;
    projectId: string;
    properties: Record<string, unknown>;
    uuid: string;
  }): void {
    this.onboarding.trackGuidedOnboardingEvent(input);
  }
}
