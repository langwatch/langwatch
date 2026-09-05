import type { PrismaClient } from "~/generated/prisma/client";
import {
  type OnboardingVariant,
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
