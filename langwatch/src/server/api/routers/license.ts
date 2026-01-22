import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkOrganizationPermission } from "../rbac";
import { type LicenseStatus } from "../../../../ee/licensing";
import { getLicenseHandler } from "~/server/subscriptionHandler";

export const licenseRouter = createTRPCRouter({
  /**
   * Gets the current license status for an organization.
   */
  getStatus: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      })
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input }): Promise<LicenseStatus> => {
      return getLicenseHandler().getLicenseStatus(input.organizationId);
    }),

  /**
   * Uploads and validates a new license for an organization.
   */
  upload: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        licenseKey: z.string().min(1, "License key is required"),
      })
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input }) => {
      const result = await getLicenseHandler().validateAndStoreLicense(
        input.organizationId,
        input.licenseKey
      );

      if (!result.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error,
        });
      }

      return {
        success: true,
        planInfo: result.planInfo,
      };
    }),

  /**
   * Removes the license from an organization.
   */
  remove: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      })
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input }) => {
      const result = await getLicenseHandler().removeLicense(input.organizationId);

      return {
        success: true,
        removed: result.removed,
      };
    }),
});
