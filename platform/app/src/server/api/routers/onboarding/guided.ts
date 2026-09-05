/**
 * The guided onboarding procedures, merged into `onboarding.*`. Each one
 * writes the organization's guided state through the service and answers
 * with the state after the write. Membership of the organization is the
 * guard: the state is the organization's own, not an administrator's.
 *
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { z } from "zod";
import { protectedProcedure } from "~/server/api/trpc";
import { GuidedOnboardingService } from "~/server/onboarding/guided-onboarding.service";

const organizationInput = z.object({ organizationId: z.string() });

export const guidedOnboardingProcedures = {
  getGuidedState: protectedProcedure
    .input(organizationInput)
    .permission("organization:view")
    .query(async ({ input, ctx }) => {
      return GuidedOnboardingService.create(ctx.prisma).getState({
        organizationId: input.organizationId,
      });
    }),

  recordPaths: protectedProcedure
    .input(organizationInput.extend({ paths: z.array(z.string()).min(1) }))
    .permission("organization:view")
    .mutation(async ({ input, ctx }) => {
      return GuidedOnboardingService.create(ctx.prisma).recordPaths(
        { organizationId: input.organizationId, userId: ctx.session.user.id },
        { paths: input.paths },
      );
    }),

  recordProvider: protectedProcedure
    .input(
      organizationInput.extend({
        provider: z.string().min(1),
        model: z.string().min(1),
      }),
    )
    .permission("organization:view")
    .mutation(async ({ input, ctx }) => {
      return GuidedOnboardingService.create(ctx.prisma).recordProvider(
        { organizationId: input.organizationId, userId: ctx.session.user.id },
        { provider: input.provider, model: input.model },
      );
    }),

  recordProviderSkipped: protectedProcedure
    .input(organizationInput)
    .permission("organization:view")
    .mutation(async ({ input, ctx }) => {
      return GuidedOnboardingService.create(ctx.prisma).recordProviderSkipped({
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
      });
    }),

  recordTour: protectedProcedure
    .input(
      organizationInput.extend({
        status: z.enum(["completed", "skipped", "replayed"]),
      }),
    )
    .permission("organization:view")
    .mutation(async ({ input, ctx }) => {
      return GuidedOnboardingService.create(ctx.prisma).recordTour(
        { organizationId: input.organizationId, userId: ctx.session.user.id },
        { status: input.status },
      );
    }),

  beginPath: protectedProcedure
    .input(organizationInput.extend({ path: z.string() }))
    .permission("organization:view")
    .mutation(async ({ input, ctx }) => {
      return GuidedOnboardingService.create(ctx.prisma).beginPath(
        { organizationId: input.organizationId, userId: ctx.session.user.id },
        { path: input.path },
      );
    }),

  completePath: protectedProcedure
    .input(organizationInput.extend({ path: z.string() }))
    .permission("organization:view")
    .mutation(async ({ input, ctx }) => {
      return GuidedOnboardingService.create(ctx.prisma).completePath(
        { organizationId: input.organizationId, userId: ctx.session.user.id },
        { path: input.path },
      );
    }),

  attachConversation: protectedProcedure
    .input(organizationInput.extend({ conversationId: z.string().min(1) }))
    .permission("organization:view")
    .mutation(async ({ input, ctx }) => {
      return GuidedOnboardingService.create(ctx.prisma).attachConversation(
        { organizationId: input.organizationId, userId: ctx.session.user.id },
        { conversationId: input.conversationId },
      );
    }),
};
