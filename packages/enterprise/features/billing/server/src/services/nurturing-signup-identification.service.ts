import { reportNurturingFailure, tryNurturingSink } from "./nurturing-sink";
import type { OrganizationIntent } from "@langwatch/prisma-client/generated";

import type { CioPersonTraits } from "@langwatch/enterprise-billing-contract";

/**
 * The onboarding answers a new person gives, as this signal reads them.
 *
 * The schema itself belongs to the sign-up form, which is a browser module;
 * what reaches Customer.io is these optional strings plus whatever attribution
 * the form collected, so the shape is stated here rather than importing a form
 * across the boundary.
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
 * Returns a new object with null, undefined, and empty-string values
 * removed. Lets call sites list traits as data (`lead_source: foo?.bar`)
 * instead of boilerplate conditional spreads. The return type narrows
 * values to `NonNullable<T[K]>` so the result is assignable to trait
 * containers that don't accept null.
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

/**
 * Identifies a new user in Customer.io during onboarding.
 *
 * Fires three calls — identifyUser, groupUser, trackEvent —
 * all fire-and-forget so that Customer.io failures never block onboarding.
 */
export function fireSignupNurturingCalls({
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
  if (!nurturing) return;

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
        ...(signUpData ?? {}),
        primary_intent: primaryIntent?.toLowerCase(),
      }),
    })
    .catch(reportNurturingFailure);
}
