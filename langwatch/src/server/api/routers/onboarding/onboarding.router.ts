import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { captureException } from "~/utils/posthogErrorCapture";
import { fireSignupNurturingCalls } from "~/../ee/billing/nurturing/hooks/signupIdentification";
import {
  fireProductInterestNurturing,
  mapProductSelectionToTrait,
} from "~/../ee/billing/nurturing/hooks/productInterest";

import { skipPermissionCheck } from "../../rbac";
import { organizationRouter } from "../organization";
import { projectRouter } from "../project";

import { signUpDataSchema } from "./schemas/sign-up-data.schema";

/**
 * Router for handling onboarding-related operations.
 */
export const onboardingRouter = createTRPCRouter({
  /**
   * Sets the product_interest trait in Customer.io after the user picks
   * a flavour on the onboarding "Pick your flavour" screen.
   *
   * This is a separate call from signup identification because
   * initializeOrganization fires BEFORE the flavour screen.
   * Fire-and-forget: the mutation resolves immediately.
   */
  setProductInterest: protectedProcedure
    .input(
      z.object({
        productInterest: z.enum([
          "observability",
          "evaluations",
          "prompt-management",
          "agent-simulations",
        ]),
      }),
    )
    .use(skipPermissionCheck)
    .mutation(({ input, ctx }) => {
      const traitValue = mapProductSelectionToTrait(input.productInterest);
      fireProductInterestNurturing({
        userId: ctx.session.user.id,
        productInterest: traitValue,
      });
      return { success: true };
    }),

  /**
   * Initializes an organization and its associated project.
   *
   * This procedure handles the creation of a new organization and assigns it to a user.
   * It also creates a project under the newly created organization.
   *
   * @throws {TRPCError} - Throws an error if organization or project creation fails.
   */
  initializeOrganization: protectedProcedure
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
      }),
    )
    .use(skipPermissionCheck)
    .mutation(async ({ input, ctx }) => {
      try {
        // Create and assign organization
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

        // Create project under the organization
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

        try {
          const signupPayload = {
            userName: ctx.session.user.name,
            userEmail: ctx.session.user.email,
            organizationName: orgResult.organization.name,
            phoneNumber: input.phoneNumber,
            signUpData: input.signUpData,
          };

          await Promise.all([
            getApp().notifications.sendSlackSignupEvent({
              ...signupPayload,
              utmCampaign: input.signUpData?.utmCampaign,
            }),
            getApp().notifications.sendHubspotSignupForm(signupPayload),
          ]);
        } catch (error) {
          captureException(error);
        }

        fireSignupNurturingCalls({
          userId: ctx.session.user.id,
          email: ctx.session.user.email,
          name: ctx.session.user.name,
          organizationId: orgResult.organization.id,
          organizationName: orgResult.organization.name,
          signUpData: input.signUpData,
        });

        // Return success response with team and project slugs
        return {
          success: true,
          teamSlug: orgResult.team.slug,
          teamName: orgResult.team.name,
          teamId: orgResult.team.id,
          organizationId: orgResult.organization.id,
          projectSlug: projectResult.projectSlug,
        };
      } catch (error) {
        captureException(error);
        throw error;
      }
    }),
});
