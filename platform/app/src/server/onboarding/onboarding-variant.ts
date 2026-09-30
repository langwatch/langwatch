import type { PrismaClient } from "~/generated/prisma/client";
import {
  type GuidedOnboardingState,
  type OnboardingVariant,
  parseGuidedOnboardingState,
  parseOnboardingVariant,
} from "~/server/schemas/sign-up-data.schema";

/**
 * Which onboarding the organization behind a project went through, for a
 * milestone tracked from a project-scoped procedure. Null when the project
 * is unknown or the organization predates the experiment.
 */
export async function readOnboardingVariantForProject({
  prisma,
  projectId,
}: {
  prisma: PrismaClient;
  projectId: string;
}): Promise<OnboardingVariant | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      team: { select: { organization: { select: { signupData: true } } } },
    },
  });
  return parseOnboardingVariant(project?.team?.organization?.signupData);
}

export interface GuidedOnboardingForProject {
  organizationId: string;
  variant: OnboardingVariant | null;
  state: GuidedOnboardingState;
}

/**
 * The organization's guided onboarding behind a project: its variant and
 * where the guided onboarding stands, including the conversation it runs
 * in. Null when the project is unknown.
 */
export async function readGuidedOnboardingForProject({
  prisma,
  projectId,
}: {
  prisma: PrismaClient;
  projectId: string;
}): Promise<GuidedOnboardingForProject | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      team: {
        select: {
          organization: { select: { id: true, signupData: true } },
        },
      },
    },
  });
  const organization = project?.team?.organization;
  if (!organization) return null;
  return {
    organizationId: organization.id,
    variant: parseOnboardingVariant(organization.signupData),
    state: parseGuidedOnboardingState(organization.signupData),
  };
}
