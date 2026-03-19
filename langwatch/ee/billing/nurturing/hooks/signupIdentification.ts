import { getApp } from "../../../../src/server/app-layer/app";
import { captureException } from "../../../../src/utils/posthogErrorCapture";
import type { CioPersonTraits } from "../types";

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
  signUpData?: {
    yourRole?: string | null;
    companySize?: string | null;
    usage?: string | null;
    solution?: string | null;
    featureUsage?: string | null;
    utmCampaign?: string | null;
    howDidYouHearAboutUs?: string | null;
  } | null;
}): void {
  const nurturing = getApp().nurturing;
  if (!nurturing) return;

  const traits: Partial<CioPersonTraits> = {
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(signUpData?.yourRole ? { role: signUpData.yourRole } : {}),
    ...(signUpData?.companySize
      ? { company_size: signUpData.companySize }
      : {}),
    ...(signUpData?.usage ? { signup_usage: signUpData.usage } : {}),
    ...(signUpData?.solution ? { signup_solution: signUpData.solution } : {}),
    ...(signUpData?.featureUsage
      ? { signup_feature_usage: signUpData.featureUsage }
      : {}),
    ...(signUpData?.utmCampaign
      ? { utm_campaign: signUpData.utmCampaign }
      : {}),
    ...(signUpData?.howDidYouHearAboutUs
      ? { how_heard: signUpData.howDidYouHearAboutUs }
      : {}),
    has_traces: false,
    has_evaluations: false,
    has_prompts: false,
    has_simulations: false,
    createdAt: new Date().toISOString(),
  };

  void nurturing
    .identifyUser({ userId, traits })
    .catch(captureException);

  void nurturing
    .groupUser({ userId, groupId: organizationId, traits: {
      name: organizationName,
      ...(signUpData?.companySize
        ? { company_size: signUpData.companySize }
        : {}),
      plan: "free",
    }})
    .catch(captureException);

  void nurturing
    .trackEvent({ userId, event: "signed_up", properties: {
      ...(signUpData ?? {}),
    }})
    .catch(captureException);
}
