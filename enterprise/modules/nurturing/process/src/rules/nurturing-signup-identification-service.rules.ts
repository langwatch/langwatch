import type {
  CioBatchCall,
  CioPersonTraits,
  NurturingSignalOf,
} from "@langwatch/enterprise-nurturing-contract";
import { nowInstant } from "@langwatch/time";

type SignUpData = NurturingSignalOf<"signed_up">["signUpData"];

/**
 * Drops null, undefined and empty-string values, so call sites list traits as data
 * instead of conditional spreads. Overloaded: a string-ish input gets a typed result,
 * with no assertion on either side.
 */
function pickDefined(obj: Record<string, string | null | undefined>): Record<string, string>;
function pickDefined(obj: Record<string, unknown>): Record<string, unknown>;
function pickDefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== "") {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Decides the identify, group and track calls that identify a new user in Customer.io
 * during onboarding.
 */
export function fireSignup({
  userId,
  email,
  name,
  organizationId,
  organizationName,
  signUpData,
  primaryIntent,
}: {
  userId: string;
  email?: string | null;
  name?: string | null;
  organizationId: string;
  organizationName: string;
  signUpData?: SignUpData;
  /** ADR-038 org intent — explicit trait; deliberately NOT part of signupData. */
  primaryIntent?: string | null;
}): CioBatchCall[] {
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
    createdAt: nowInstant().toString({ fractionalSecondDigits: 3 }),
  };

  return [
    { type: "identify", userId, traits },
    {
      type: "group",
      userId,
      groupId: organizationId,
      traits: {
        name: organizationName,
        ...pickDefined({ company_size: signUpData?.companySize }),
        plan: "free",
      },
    },
    {
      type: "track",
      userId,
      event: "signed_up",
      properties: pickDefined({
        ...signUpData,
        primary_intent: primaryIntent?.toLowerCase(),
      }),
    },
  ];
}
