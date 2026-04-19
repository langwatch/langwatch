import type { Attribution } from "../../../../src/hooks/attribution";
import { getApp } from "../../../../src/server/app-layer/app";
import { captureException } from "../../../../src/utils/posthogErrorCapture";
import type { CioPersonTraits } from "../types";

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
  for (const key in obj) {
    const value = obj[key];
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
}: {
  userId: string;
  email: string | null | undefined;
  name: string | null | undefined;
  organizationId: string;
  organizationName: string;
  signUpData?:
    | (Partial<Attribution> & {
        yourRole?: string | null;
        companySize?: string | null;
        usage?: string | null;
        solution?: string | null;
        featureUsage?: string | null;
        howDidYouHearAboutUs?: string | null;
      })
    | null;
}): void {
  const nurturing = getApp().nurturing;
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
    }),
    has_traces: false,
    has_evaluations: false,
    has_prompts: false,
    has_simulations: false,
    has_subscription: false,
    createdAt: new Date().toISOString(),
  };

  void nurturing.identifyUser({ userId, traits }).catch(captureException);

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
    .catch(captureException);

  void nurturing
    .trackEvent({
      userId,
      event: "signed_up",
      properties: { ...(signUpData ?? {}) },
    })
    .catch(captureException);
}
