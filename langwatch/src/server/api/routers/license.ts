import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkOrganizationPermission } from "../rbac";
import {
  LicenseHandler,
  PUBLIC_KEY,
  type LicenseStatus,
} from "../../../../ee/licensing";
import { env } from "~/env.mjs";

/**
 * Creates a LicenseHandler instance for the given context.
 */
function createLicenseHandler(prisma: PrismaClient) {
  return new LicenseHandler({
    prisma,
    licenseEnforcementEnabled: env.LICENSE_ENFORCEMENT_ENABLED ?? false,
    publicKey: PUBLIC_KEY,
  });
}

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
    .query(async ({ input, ctx }): Promise<LicenseStatus> => {
      const licenseHandler = createLicenseHandler(ctx.prisma);
      return licenseHandler.getLicenseStatus(input.organizationId);
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
    .mutation(async ({ input, ctx }) => {
      const licenseHandler = createLicenseHandler(ctx.prisma);
      const result = await licenseHandler.storeLicense(
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
    .mutation(async ({ input, ctx }) => {
      const licenseHandler = createLicenseHandler(ctx.prisma);
      await licenseHandler.removeLicense(input.organizationId);

      return {
        success: true,
      };
    }),
});
