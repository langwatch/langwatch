import {
  parseGuidedOnboardingState,
  parseOnboardingVariant,
} from "~/server/schemas/sign-up-data.schema";
import type { GuidedPath } from "../paths";

/**
 * Where the welcome page stands for a user who already has an organization:
 * either the guided takeover is still unfinished, and the page resumes it,
 * or the user belongs in the product and the classic redirect applies.
 *
 * The takeover is unfinished while the organization is in the guided variant
 * and the provider step has neither connected nor been skipped. A reload, a
 * closed tab or a second device all land here and continue from the durable
 * state: no picks yet means the hello screen, picks without a provider means
 * the provider screen.
 */

export type TakeoverPhase = "hello" | "value" | "provider";

export interface GuidedResume {
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectSlug: string;
  usageStyle: string | null;
  paths: GuidedPath[];
  phase: TakeoverPhase;
}

interface ResumableOrganization {
  id: string;
  name: string;
  signupData: unknown;
  teams: {
    isPersonal?: boolean;
    projects: { id: string; slug: string }[];
  }[];
}

export function resolveGuidedResume({
  organizations,
}: {
  organizations: ResumableOrganization[] | undefined;
}): GuidedResume | null {
  for (const organization of organizations ?? []) {
    if (parseOnboardingVariant(organization.signupData) !== "guided") continue;
    const state = parseGuidedOnboardingState(organization.signupData);
    if (state.provider || state.providerSkippedAt) continue;

    const project = organization.teams
      .filter((team) => !team.isPersonal)
      .flatMap((team) => team.projects)[0];
    if (!project) continue;

    const signupData =
      organization.signupData && typeof organization.signupData === "object"
        ? (organization.signupData as Record<string, unknown>)
        : {};
    const usage = signupData.usage;

    return {
      organizationId: organization.id,
      organizationName: organization.name,
      projectId: project.id,
      projectSlug: project.slug,
      usageStyle: typeof usage === "string" ? usage : null,
      paths: state.paths,
      phase: state.paths.length > 0 ? "provider" : "hello",
    };
  }
  return null;
}
