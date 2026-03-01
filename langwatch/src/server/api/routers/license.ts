import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkOrganizationPermission } from "../rbac";
import {
  type LicenseStatus,
  OrganizationNotFoundError,
  getPlanTemplate,
} from "../../../../ee/licensing";
import type { LicenseData } from "../../../../ee/licensing";
import { signLicense, encodeLicenseKey, generateLicenseId } from "../../../../ee/licensing/signing";
import { getLicenseHandler } from "~/server/subscriptionHandler";

/** Schema for plan limits input */
const planLimitsSchema = z.object({
  maxMembers: z.number().int().positive("Plan limits must be positive numbers"),
  maxMembersLite: z.number().int().positive("Plan limits must be positive numbers"),
  maxTeams: z.number().int().positive("Plan limits must be positive numbers"),
  maxProjects: z.number().int().positive("Plan limits must be positive numbers"),
  maxMessagesPerMonth: z.number().int().positive("Plan limits must be positive numbers"),
  evaluationsCredit: z.number().int().positive("Plan limits must be positive numbers"),
  maxWorkflows: z.number().int().positive("Plan limits must be positive numbers"),
  maxPrompts: z.number().int().positive("Plan limits must be positive numbers"),
  maxEvaluators: z.number().int().positive("Plan limits must be positive numbers"),
  maxScenarios: z.number().int().positive("Plan limits must be positive numbers"),
  maxAgents: z.number().int().positive("Plan limits must be positive numbers"),
  maxExperiments: z.number().int().positive("Plan limits must be positive numbers"),
  canPublish: z.boolean(),
  usageUnit: z.enum(["traces", "events"]),
});

/** Schema for license generation input */
const generateLicenseSchema = z.object({
  privateKey: z.string().min(1, "Private key is required"),
  organizationName: z.string().min(1, "Organization name is required"),
  email: z.string().email("Invalid email format"),
  expiresAt: z.date(),
  planType: z.enum(["PRO", "ENTERPRISE", "CUSTOM"]),
  plan: planLimitsSchema,
});

export const licenseRouter = createTRPCRouter({
  /**
   * Gets the current license status for an organization.
   */
  getStatus: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
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
        organizationId: z.string().min(1),
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
        organizationId: z.string().min(1),
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

  /**
   * Generates a new license key.
   * Requires organization:manage permission - only org admins can generate licenses.
   */
  generate: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
      }).merge(generateLicenseSchema)
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input }) => {
      const { privateKey, organizationName, email, expiresAt, planType, plan } = input;

      // Validate expiration is in the future
      if (expiresAt <= new Date()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Expiration date must be in the future",
        });
      }

      // Get plan template for name/type
      const template = getPlanTemplate(planType);
      const planName = template?.name ?? planType;
      const planTypeValue = template?.type ?? planType;

      // Build the license data
      const licenseData: LicenseData = {
        licenseId: generateLicenseId(),
        version: 1,
        organizationName,
        email,
        issuedAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        plan: {
          type: planTypeValue,
          name: planName,
          maxMembers: plan.maxMembers,
          maxMembersLite: plan.maxMembersLite,
          maxTeams: plan.maxTeams,
          maxProjects: plan.maxProjects,
          maxMessagesPerMonth: plan.maxMessagesPerMonth,
          evaluationsCredit: plan.evaluationsCredit,
          maxWorkflows: plan.maxWorkflows,
          maxPrompts: plan.maxPrompts,
          maxEvaluators: plan.maxEvaluators,
          maxScenarios: plan.maxScenarios,
          maxAgents: plan.maxAgents,
          maxExperiments: plan.maxExperiments,
          canPublish: plan.canPublish,
          usageUnit: plan.usageUnit,
        },
      };

      try {
        // Sign the license
        const signedLicense = signLicense(licenseData, privateKey);

        // Encode as base64
        const licenseKey = encodeLicenseKey(signedLicense);

        return { licenseKey };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Failed to sign license. Please check your private key.",
        });
      }
    }),
});
