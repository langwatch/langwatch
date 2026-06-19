import { z } from "zod";
import { captureException } from "../../../utils/posthogErrorCapture";
import { getApp } from "../../app-layer/app";
import {
  createLicenseEnforcementService,
  limitTypeSchema,
  limitTypes,
} from "../../license-enforcement";
import { getLimitBreakdownByProject } from "../../license-enforcement/limit-breakdown";
import { checkOrganizationPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

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
   * List the resources counting toward a limit, grouped by project, so the
   * upgrade dialog can show where an org-wide count comes from. Returns an
   * empty list for limit types that have no listable per-project resources.
   */
  getLimitBreakdown: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        limitType: limitTypeSchema,
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ ctx, input }) => {
      return getLimitBreakdownByProject(ctx.prisma, {
        organizationId: input.organizationId,
        limitType: input.limitType,
      });
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
      }
    }),
});
