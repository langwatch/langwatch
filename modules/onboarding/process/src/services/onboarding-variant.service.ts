import { createLogger } from "@langwatch/observability";
/**
 * The onboarding experiment's assignment, recorded once as the organization is
 * created so nurturing can track the exposure for either variant.
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import type {
  OnboardingVariant,
  OnboardingVariantAssignedEventData,
} from "@langwatch/onboarding-contract";

const logger = createLogger("langwatch:onboarding:variant");

/** Tells the lifecycle pipeline which variant an organization was created with. */
export type OnboardingVariantAnnouncer = (
  input: Omit<OnboardingVariantAssignedEventData, "tenantId" | "occurredAt">,
) => Promise<void>;

export class OnboardingVariantService {
  private constructor(private readonly announce: OnboardingVariantAnnouncer) {}

  static create(options: { announce: OnboardingVariantAnnouncer }): OnboardingVariantService {
    return new OnboardingVariantService(options.announce);
  }

  /** Never fails the sign-up: an assignment that cannot be announced is only logged. */
  async recordAssigned(input: {
    organizationId: string;
    userId: string;
    variant: OnboardingVariant;
  }): Promise<void> {
    try {
      await this.announce(input);
    } catch (error) {
      logger.error(
        { error, organizationId: input.organizationId, variant: input.variant },
        "onboarding variant assignment not announced",
      );
    }
  }
}
