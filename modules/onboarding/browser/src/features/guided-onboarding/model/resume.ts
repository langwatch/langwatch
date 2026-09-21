/**
 * Where the welcome page stands for an organization already in the guided
 * variant with its guide not yet ended: resumed from the durable state.
 * @see specs/features/onboarding/guided-welcome-takeover.feature
 */
import {
  type GuidedPath,
  parseGuidedOnboardingState,
  parseOnboardingVariant,
} from "@langwatch/onboarding-contract";

export type TakeoverPhase = "hello" | "value" | "provider";

interface ResumedOrganization {
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectSlug: string;
  usageStyle: string | null;
  paths: GuidedPath[];
}

/** The takeover screen to draw again. */
export interface TakeoverResume extends ResumedOrganization {
  phase: TakeoverPhase;
}

/** The landing that follows the provider step, with the provider recorded. */
export interface LandingResume extends ResumedOrganization {
  phase: "landing";
  /** The path the landing opens: the one being guided, else the first pick. */
  landingPath: GuidedPath;
}

export type GuidedResume = TakeoverResume | LandingResume;

interface ResumableOrganization {
  id: string;
  name: string;
  signupData: unknown;
  teams: {
    isPersonal?: boolean;
    projects: { id: string; slug: string }[];
  }[];
}

/** What the tailor step recorded, when it recorded a string. */
function usageStyleOf(signupData: unknown): string | null {
  if (!signupData || typeof signupData !== "object") return null;
  const usage = (signupData as Record<string, unknown>).usage;
  return typeof usage === "string" ? usage : null;
}

/** Where this one organization stands, or null if it is not resumable. */
function resumeForOrganization(organization: ResumableOrganization): GuidedResume | null {
  if (parseOnboardingVariant(organization.signupData) !== "guided") return null;
  const state = parseGuidedOnboardingState(organization.signupData);
  if (state.providerSkippedAt) return null;
  if (state.provider && (state.tourCompletedAt || state.tourSkippedAt)) {
    return null;
  }

  const project = organization.teams
    .filter((team) => !team.isPersonal)
    .flatMap((team) => team.projects)[0];
  if (!project) return null;

  const resumed: ResumedOrganization = {
    organizationId: organization.id,
    organizationName: organization.name,
    projectId: project.id,
    projectSlug: project.slug,
    usageStyle: usageStyleOf(organization.signupData),
    paths: state.paths,
  };
  if (state.provider) {
    return {
      ...resumed,
      phase: "landing",
      landingPath: state.currentPath ?? state.paths[0] ?? "llmops",
    };
  }
  return { ...resumed, phase: state.paths.length > 0 ? "provider" : "hello" };
}

export function resolveGuidedResume({
  organizations,
}: {
  organizations: ResumableOrganization[] | undefined;
}): GuidedResume | null {
  for (const organization of organizations ?? []) {
    const resume = resumeForOrganization(organization);
    if (resume) return resume;
  }
  return null;
}
