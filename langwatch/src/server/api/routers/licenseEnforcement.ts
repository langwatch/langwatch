import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  createLicenseEnforcementService,
  limitTypes,
  limitTypeSchema,
} from "../../license-enforcement";
import {
  checkUserPermissionForOrganization,
  OrganizationRoleGroup,
} from "../permission";

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
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_USAGE,
      ),
    )
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
    .use(
      checkUserPermissionForOrganization(
        OrganizationRoleGroup.ORGANIZATION_USAGE,
      ),
    )
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
});
