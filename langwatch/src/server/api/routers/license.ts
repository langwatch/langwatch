import { platformSSOAllowed } from "@ee/sso/sso-gate";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "~/env.mjs";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getLicenseHandler } from "~/server/subscriptionHandler";
import type { LicenseData } from "../../../../ee/licensing";
import { getPlanTemplate, type LicenseStatus } from "../../../../ee/licensing";
import { licenseValidationError } from "../../../../ee/licensing/errors";
import { buildMintedPlan } from "../../../../ee/licensing/mintedPlan";
import {
  encodeLicenseKey,
  generateLicenseId,
  signLicense,
} from "../../../../ee/licensing/signing";
import { checkOrganizationPermission, skipPermissionCheck } from "../rbac";

const logger = createLogger("langwatch:api:licenseRouter");

/**
 * Schema for plan limits input. Licenses encode only the enforced levers
 * (member seats, messages volume) plus identity; projects, teams, and
 * experimentation resources are OSS/uncapped and not part of licenses.
 */
const planLimitsSchema = z.object({
  maxMembers: z.number().int().positive("Plan limits must be positive numbers"),
  maxMembersLite: z
    .number()
    .int()
    .positive("Plan limits must be positive numbers"),
  maxMessagesPerMonth: z
    .number()
    .int()
    .positive("Plan limits must be positive numbers"),
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
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input }): Promise<LicenseStatus> => {
      // No catch: `OrganizationNotFoundError` is a `HandledError`, so the
      // shared middleware maps it to NOT_FOUND and keeps it as the cause.
      // Re-wrapping it here threw away the code and the trace id.
      return await getLicenseHandler().getLicenseStatus(input.organizationId);
    }),

  /**
   * Whether this deployment is configured for single sign-on that the license
   * gate is refusing to switch on.
   *
   * The public environment cannot answer it: `NEXTAUTH_PROVIDER` there is the
   * RESOLVED provider, which reports "email" for an unlicensed deployment and
   * for one that never wanted SSO alike. Telling those apart is the whole point
   * here, because the first is an operator who configured an IdP, upgraded, and
   * now watches their company sign in by email with nothing on screen to say
   * why (ADR-027 decided logs-only telemetry for the gate; this is a settings
   * page, not telemetry).
   *
   * Deployment-wide rather than per-organization, so there is no organization
   * to check a permission against and it skips that check deliberately. It
   * stays behind a session: an anonymous visitor has no business learning that
   * an install is unlicensed, and every signed-in user can already see the
   * sign-in form this explains.
   */
  getSsoGateStatus: protectedProcedure
    .input(z.object({}))
    .use(skipPermissionCheck)
    .query(async () => {
      const configuredProvider = env.NEXTAUTH_PROVIDER;
      if (!configuredProvider || configuredProvider === "email") {
        return { configuredProvider: null, licensed: true };
      }

      return {
        configuredProvider,
        licensed: await platformSSOAllowed(),
      };
    }),

  /**
   * Uploads and validates a new license for an organization.
   */
  upload: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        licenseKey: z.string().min(1, "License key is required"),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input }) => {
      const result = await getLicenseHandler().validateAndStoreLicense(
        input.organizationId,
        input.licenseKey,
      );

      if (!result.success) {
        // The handler reports its verdict as a `LICENSE_ERRORS` literal, which
        // is a server discriminant and not copy. Map it to the code the
        // presentation registry writes customer copy against.
        throw licenseValidationError(result.error);
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
        organizationId: z.string().min(1),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input }) => {
      const result = await getLicenseHandler().removeLicense(
        input.organizationId,
      );

      return {
        success: true,
        removed: result.removed,
      };
    }),

  /**
   * Generates a new license key.
   * Requires organization:manage permission - only org admins can generate licenses.
   */
  generate: protectedProcedure
    .input(
      z
        .object({
          organizationId: z.string().min(1),
        })
        .merge(generateLicenseSchema),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input }) => {
      const { privateKey, organizationName, email, expiresAt, planType, plan } =
        input;

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
        plan: buildMintedPlan({
          type: planTypeValue,
          name: planName,
          maxMembers: plan.maxMembers,
          maxMembersLite: plan.maxMembersLite,
          maxMessagesPerMonth: plan.maxMessagesPerMonth,
          canPublish: plan.canPublish,
          usageUnit: plan.usageUnit,
        }),
      };

      try {
        // Sign the license
        const signedLicense = signLicense(licenseData, privateKey);

        // Encode as base64
        const licenseKey = encodeLicenseKey(signedLicense);

        return { licenseKey };
      } catch (error) {
        logger.error(
          { organizationId: input.organizationId, error },
          "[license] Failed to sign license",
        );
        // A signing-key failure already says which of the three things went
        // wrong, and the handled-error middleware maps it to a 400 with that
        // code intact. Re-wrapping would flatten all three into one message
        // the UI cannot key off.
        if (HandledError.isHandled(error)) throw error;
        // Real copy on a 4xx, so the authored-prose channel renders it as-is;
        // the cause rides along for the logs rather than being discarded, and
        // is never shown (its message would be a crypto diagnostic).
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Failed to sign license. Please check your private key.",
          cause: error,
        });
      }
    }),
});
