import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  createLicenseEnforcementService,
  limitTypes,
  limitTypeSchema,
} from "../../license-enforcement";
import { checkOrganizationPermission } from "../rbac";
import { getApp } from "../../app-layer/app";
import { captureException } from "../../../utils/posthogErrorCapture";
import { trackServerEvent } from "~/server/posthog";

export const licenseEnforcementRouter = createTRPCRouter({
  /**
   * Check if a specific limit allows creating another resource.
   * Use this before showing create buttons or forms.
   */
  checkLimit: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        limitType: limitTypeSchema,
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const service = createLicenseEnforcementService(ctx.prisma);
      return service.checkLimit(
        input.organizationId,
        input.limitType,
        ctx.session.user,
      );
    }),

  /**
   * Check all limits at once for the organization.
   * Useful for dashboards or settings pages that show multiple limits.
   */
  checkAllLimits: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      const service = createLicenseEnforcementService(ctx.prisma);
      const results = await Promise.all(
        limitTypes.map((type) =>
          service.checkLimit(input.organizationId, type, ctx.session.user),
        ),
      );
      return Object.fromEntries(results.map((r) => [r.limitType, r])) as Record<
        (typeof limitTypes)[number],
        (typeof results)[number]
      >;
    }),

  /**
   * Report that a UI pre-check blocked a user from creating a resource.
   *
   * Fire-and-forget from the client's perspective: the upgrade modal
   * appears immediately; this mutation triggers an ops notification
   * as a side effect. Server re-verifies the limit to prevent
   * fabricated requests from triggering false alerts.
   */
  reportLimitBlocked: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        limitType: limitTypeSchema,
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .mutation(async ({ ctx, input }) => {
      const service = createLicenseEnforcementService(ctx.prisma);
      const result = await service.checkLimit(
        input.organizationId,
        input.limitType,
        ctx.session.user,
      );

      if (!result.allowed) {
        void getApp()
          .usageLimits.notifyResourceLimitReached({
            organizationId: input.organizationId,
            limitType: input.limitType,
            current: result.current,
            max: result.max,
          })
          .catch(captureException);

        trackServerEvent({
          userId: ctx.session.user.id,
          event: "limit_blocked",
          properties: {
            limitType: input.limitType,
            current: result.current,
            max: result.max,
            source: "ui_pre_check",
          },
        });
      }
    }),
});
