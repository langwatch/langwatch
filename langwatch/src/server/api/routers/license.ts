import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkOrganizationPermission } from "../rbac";
import { type LicenseStatus, OrganizationNotFoundError } from "../../../../ee/licensing";
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
      try {
        return await getLicenseHandler().getLicenseStatus(input.organizationId);
      } catch (error) {
        if (error instanceof OrganizationNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }
        throw error;
      }
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
      try {
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
      } catch (error) {
        if (error instanceof OrganizationNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }
        throw error;
      }
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
      try {
        const result = await getLicenseHandler().removeLicense(input.organizationId);

        return {
          success: true,
          removed: result.removed,
        };
      } catch (error) {
        if (error instanceof OrganizationNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }
        throw error;
      }
    }),
});
