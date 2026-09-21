import type { GuidedOnboardingRecord } from "@langwatch/onboarding-contract";

/**
 * One record per organization. A service depends on this abstract surface,
 * never on the concrete Redis or memory adapter behind it. This module owns
 * the row — not `Organization.signupData`, which belongs to organization.
 */
export abstract class GuidedOnboardingStateRepository {
  /** The recorded state, or nothing for an organization that never wrote one. */
  abstract find(organizationId: string): Promise<GuidedOnboardingRecord | null>;

  /** Replaces the whole record: the caller has already merged onto the previous read. */
  abstract write(organizationId: string, record: GuidedOnboardingRecord): Promise<void>;
}
