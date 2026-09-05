/**
 * The guided onboarding state through a project credential: what the CLI
 * reaches when Langy, working inside its sandbox with the conversation's key,
 * reports a path as done. The state belongs to the project's organization.
 *
 * Guarded by the langy permissions rather than the project family: a Langy
 * session key never carries `project:*` (the family is withheld as auth
 * scope), and this state is exactly what Langy is driving.
 *
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import type { BaseApp, VersionBuilder } from "@langwatch/api";
import type { Context } from "hono";
import { z } from "zod";
import type { Project } from "~/generated/prisma/client";
import { createProjectService } from "~/server/api/v1/project-service";
import { V1_API_VERSION } from "~/server/api/v1/version";
import { prisma } from "~/server/db";
import { GuidedOnboardingService } from "~/server/onboarding/guided-onboarding.service";
import { guidedOnboardingStateSchema } from "~/server/schemas/sign-up-data.schema";

const { service, guard } = createProjectService({
  name: "onboarding",
  basePath: "/api/v1/onboarding",
});

type OnboardingApp = BaseApp<Project>;
type OnboardingVersion = VersionBuilder<OnboardingApp>;

const pathParamsSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("The onboarding path: llmops, coding, gateway or governance."),
});

const stateOutputSchema = guidedOnboardingStateSchema.describe(
  "The guided onboarding state of the project's organization.",
);

function userOf(c: Context): string | undefined {
  return c.get("apiKeyUserId") as string | undefined;
}

function registerGuidedEndpoints(v: OnboardingVersion): void {
  v.get(
    "/guided",
    {
      ...guard("langy:view"),
      output: stateOutputSchema,
      description:
        "Read the guided onboarding state of this project's organization: the paths picked in order, the one being set up, the ones done, the provider connected, and where the tour stands.",
      docs: { operationId: "getGuidedOnboardingState", tags: ["Onboarding"] },
    },
    async (_c, { app }: { app: OnboardingApp }) => {
      const onboarding = GuidedOnboardingService.create(prisma);
      const organizationId = await onboarding.organizationIdOfProject({
        projectId: app.project.id,
      });
      return onboarding.getState({ organizationId });
    },
  );

  v.post(
    "/guided/paths/:path/complete",
    {
      ...guard("langy:create"),
      params: pathParamsSchema,
      output: stateOutputSchema,
      description:
        "Mark one guided onboarding path as done for this project's organization. Idempotent: completing a path twice changes nothing. An unknown path is refused with guided_onboarding_path_unknown.",
      docs: {
        operationId: "completeGuidedOnboardingPath",
        tags: ["Onboarding"],
      },
    },
    async (
      c,
      { params, app }: { params: { path: string }; app: OnboardingApp },
    ) => {
      const onboarding = GuidedOnboardingService.create(prisma);
      const organizationId = await onboarding.organizationIdOfProject({
        projectId: app.project.id,
      });
      return onboarding.completePath(
        { organizationId, userId: userOf(c) },
        { path: params.path },
      );
    },
  );
}

export const app = service
  .version(V1_API_VERSION, (v) => {
    registerGuidedEndpoints(v);
  })
  .build();
