// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A written scenario, as billing reports it: the `scenario_created` product
 * event carries the onboarding the organization went through, and nurturing
 * learns how many scenarios the project now holds.
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import type { ScenarioCreatedSignal } from "@langwatch/enterprise-billing-contract";
import {
  onboardingExperimentProperties,
  type OnboardingVariant,
} from "@langwatch/onboarding-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { PostHogChannel } from "../channels/posthog.channel.ts";

/** The three organization reads between a project and its onboarding variant. */
export type ScenarioSignalOrganizations = Pick<
  OrganizationApi,
  "findProject" | "tryGetOrganizationIdByTeamId" | "readGuidedOnboardingState"
>;

export class ScenarioCreatedSignalService {
  static create(deps: {
    organizations: ScenarioSignalOrganizations;
    /** Absent where the process composed no product-analytics sink. */
    posthog: PostHogChannel | undefined;
    nurture: (input: ScenarioCreatedSignal) => void;
  }): ScenarioCreatedSignalService {
    return new ScenarioCreatedSignalService(deps.organizations, deps.posthog, deps.nurture);
  }

  private constructor(
    private readonly organizations: ScenarioSignalOrganizations,
    private readonly posthog: PostHogChannel | undefined,
    private readonly nurture: (input: ScenarioCreatedSignal) => void,
  ) {}

  async record(input: ScenarioCreatedSignal): Promise<void> {
    const variant = await this.variantOf(input.projectId);
    this.posthog?.track({
      userId: input.userId,
      event: "scenario_created",
      properties: {
        ...(variant
          ? { onboarding_variant: variant, ...onboardingExperimentProperties(variant) }
          : {}),
        projectId: input.projectId,
      },
    });
    this.nurture(input);
  }

  /** Null when the project is unknown or its organization predates the experiment. */
  private async variantOf(projectId: string): Promise<OnboardingVariant | null> {
    const project = await this.organizations.findProject(projectId);
    if (!project) return null;
    const organizationId = await this.organizations.tryGetOrganizationIdByTeamId({
      teamId: project.teamId,
    });
    if (!organizationId) return null;
    const record = await this.organizations.readGuidedOnboardingState({ organizationId });
    return record.variant;
  }
}
