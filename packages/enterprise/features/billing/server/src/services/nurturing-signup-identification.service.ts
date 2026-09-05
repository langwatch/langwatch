import { reportNurturingFailure, tryNurturingSink } from "../adapters/nurturing-sink.adapter";
import type { OrganizationIntent } from "@langwatch/prisma-client/generated";

import type { CioPersonTraits } from "@langwatch/enterprise-billing-contract";

/**
 * The onboarding answers a new person gives, as this signal reads them.
 */
type SignUpData = {
  yourRole?: string | null;
  companySize?: string | null;
  usage?: string | null;
  solution?: string | null;
  featureUsage?: string | null;
  howDidYouHearAboutUs?: string | null;
  leadSource?: string | null;
  referrer?: string | null;
  utmCampaign?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
} & Record<string, unknown>;

/**
 * Returns a new object with null, undefined, and empty-string values removed. Lets call
 * sites list traits as data (`lead_source: foo?.bar`) instead of boilerplate conditional
 * spreads.
 */
function pickDefined<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]?: NonNullable<T[K]> } {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== "") {
      result[key] = value;
    }
  }

  return result as { [K in keyof T]?: NonNullable<T[K]> };
}

export class NurturingSignupIdentificationService {
  static create(): NurturingSignupIdentificationService {
    return new NurturingSignupIdentificationService();
  }

  /**
   * Identifies a new user in Customer.io during onboarding.
   */
  static fireSignup({
    userId,
    email,
    name,
    organizationId,
    organizationName,
    signUpData,
    primaryIntent,
  }: {
    userId: string;
    email: string | null | undefined;
    name: string | null | undefined;
    organizationId: string;
    organizationName: string;
    signUpData?: SignUpData | null;
    /** ADR-038 org intent — explicit trait; deliberately NOT part of signupData. */
    primaryIntent?: OrganizationIntent | null;
  }): void {
    const nurturing = tryNurturingSink();
    if (!nurturing) {
      return;
    }

    const traits: Partial<CioPersonTraits> = {
      ...pickDefined({
        email,
        name,
        role: signUpData?.yourRole,
        company_size: signUpData?.companySize,
        signup_usage: signUpData?.usage,
        signup_solution: signUpData?.solution,
        signup_feature_usage: signUpData?.featureUsage,
        utm_campaign: signUpData?.utmCampaign,
        how_heard: signUpData?.howDidYouHearAboutUs,
        lead_source: signUpData?.leadSource,
        utm_source: signUpData?.utmSource,
        utm_medium: signUpData?.utmMedium,
        utm_term: signUpData?.utmTerm,
        utm_content: signUpData?.utmContent,
        referrer: signUpData?.referrer,
        primary_intent: primaryIntent?.toLowerCase(),
      }),
      has_traces: false,
      has_evaluations: false,
      has_prompts: false,
      has_simulations: false,
      has_subscription: false,
      createdAt: new Date().toISOString(),
    };

    void nurturing.identifyUser({ userId, traits }).catch(reportNurturingFailure);

    void nurturing
      .groupUser({
        userId,
        groupId: organizationId,
        traits: {
          name: organizationName,
          ...pickDefined({ company_size: signUpData?.companySize }),
          plan: "free",
        },
      })
      .catch(reportNurturingFailure);

    void nurturing
      .trackEvent({
        userId,
        event: "signed_up",
        properties: pickDefined({
          ...signUpData,
          primary_intent: primaryIntent?.toLowerCase(),
        }),
      })
      .catch(reportNurturingFailure);
  }
}
