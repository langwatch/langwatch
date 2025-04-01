import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { skipPermissionCheck } from "../permission";
import { dependencies } from "../../../injection/dependencies.server";
import * as Sentry from "@sentry/nextjs";
import { organizationRouter } from "./organization";
import { projectRouter } from "./project";

/**
 * Input schema for organization signup data
 */
const signUpDataSchema = z.object({
  usage: z.string().optional().nullable(),
  solution: z.string().optional().nullable(),
  terms: z.boolean().optional(),
  companyType: z.string().optional().nullable(),
  companySize: z.string().optional().nullable(),
  projectType: z.string().optional().nullable(),
  howDidYouHearAboutUs: z.string().optional().nullable(),
  otherCompanyType: z.string().optional().nullable(),
  otherProjectType: z.string().optional().nullable(),
  otherHowDidYouHearAboutUs: z.string().optional().nullable(),
  utmCampaign: z.string().optional().nullable(),
});

/**
 * Onboarding router that orchestrates the organization and project creation process
 */
export const onboardingRouter = createTRPCRouter({
  /**
   * Creates an organization, team, and project in one go during onboarding
   */
  createFullOnboarding: protectedProcedure
    .input(
      z.object({
        // Organization details
        orgName: z.string().optional(),
        phoneNumber: z.string().optional(),
        signUpData: signUpDataSchema.optional(),
        
        // Project details
        projectName: z.string().optional(),
        language: z.string().default("other"),
        framework: z.string().default("other"),
      })
    )
    .use(skipPermissionCheck)
    .mutation(async ({ input, ctx }) => {
      try {
        const orgRouter = organizationRouter.createCaller(ctx);
        const orgResult = await orgRouter.createAndAssign({
          orgName: input.orgName,
          phoneNumber: input.phoneNumber,
          signUpData: input.signUpData,
        });
        if (!orgResult.success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create organization",
          });
        }

        const projectName = input.projectName ?? orgResult.team.name;
        const projectCaller = projectRouter.createCaller(ctx);
        const projectResult = await projectCaller.create({
          organizationId: orgResult.organization.id,
          teamId: orgResult.team.id,
          name: projectName,
          language: input.language,
          framework: input.framework,
        });
        if (!projectResult.success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create project",
          });
        }

        if (dependencies.postRegistrationCallback) {
          try {
            await dependencies.postRegistrationCallback(ctx.session.user, input);
          } catch (err) {
            Sentry.captureException(err);
          }
        }

        return {
          success: true,
          teamSlug: orgResult.team.slug,
          projectSlug: projectResult.projectSlug,
        };
      } catch (error) {
        Sentry.captureException(error);
        throw error;
      }
    }),
}); 
