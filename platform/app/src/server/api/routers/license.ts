import { readConnectConfig } from "@ee/licensing/connect/install/connectConfig";
import { ConnectDisabledError } from "@ee/licensing/connect/install/connectErrors";
import { getConnectLicenseClient } from "@ee/licensing/connect/install/connectLicenseClient";
import { installInstanceId } from "@ee/licensing/connect/install/instanceIdentity";
import { authProviderIsMounted, platformSSOAllowed } from "@ee/sso/sso-gate";
import { z } from "zod";
import { env } from "~/env.mjs";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { prisma } from "~/server/db";
import { getLicenseHandler } from "~/server/subscriptionHandler";
import type { LicenseStatus } from "../../../../ee/licensing";
import { licenseValidationError } from "../../../../ee/licensing/errors";

/**
 * What an organization does with the license it holds: read its status,
 * activate one, remove it.
 *
 * Issuing a license is not here. It is a LangWatch operator action in the
 * backoffice, signed with a server secret (`licenseRegistry` router, ADR-141).
 */
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
    .permission("organization:view")
    .query(async ({ input }): Promise<LicenseStatus> => {
      // No catch: `OrganizationNotFoundError` is a `HandledError`, so the
      // shared middleware maps it to NOT_FOUND and keeps it as the cause.
      // Re-wrapping it here threw away the code and the trace id.
      return await getLicenseHandler().getLicenseStatus(input.organizationId);
    }),

  /**
   * Why a deployment configured for single sign-on is not using it: either the
   * license gate is refusing to switch it on, or the provider never mounted.
   *
   * The public environment cannot answer it: `NEXTAUTH_PROVIDER` there is the
   * RESOLVED provider, which reports "email" for an unlicensed deployment, a
   * misconfigured one, and one that never wanted SSO alike. Telling them apart
   * is the whole point here, because the first two are an operator watching
   * their company sign in by email with nothing on screen to say why (ADR-027
   * decided logs-only telemetry for the gate; this is a settings page, not
   * telemetry).
   *
   * `mounted` is reported separately from `licensed` because the two are fixed
   * in different places: one by activating a license, the other by correcting
   * the provider name or its client credentials. Both land in email mode, which
   * is the no-lockout guarantee working, but neither is visible on the sign-in
   * page, and an operator who cannot see them may believe federation is being
   * enforced when it is not.
   *
   * Deployment-wide rather than per-organization, so there is no organization
   * to check a permission against and it skips that check deliberately. It
   * stays behind a session: an anonymous visitor has no business learning that
   * an install is unlicensed, and every signed-in user can already see the
   * sign-in form this explains.
   */
  getSsoGateStatus: protectedProcedure
    .input(z.object({}))
    .noPermission({
      reason:
        "instance license status is deployment-wide and read-only for any signed-in user",
    })
    .query(async () => {
      const configuredProvider = env.NEXTAUTH_PROVIDER;
      if (!configuredProvider || configuredProvider === "email") {
        return { configuredProvider: null, licensed: true, mounted: true };
      }

      return {
        configuredProvider,
        licensed: await platformSSOAllowed(),
        mounted: authProviderIsMounted(),
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
    .permission("organization:manage")
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
   * Redeems an activation code and stores the license it minted.
   *
   * The code is the credential for one call to the connect host and is never
   * stored on the install: what comes back is an ordinary signed license, which
   * goes through exactly the same validation and storage as one a customer
   * pasted. An air-gapped install pastes its license instead and calls nothing.
   */
  activate: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        code: z.string().min(1, "Activation code is required").max(200),
      }),
    )
    .permission("organization:manage")
    .mutation(async ({ input }) => {
      const config = readConnectConfig();
      if (!config.permitted) throw new ConnectDisabledError();

      const instanceId = await installInstanceId(prisma);
      const answer = await getConnectLicenseClient(
        config.licenseEndpoint,
      ).activate({ code: input.code, instanceId });

      const result = await getLicenseHandler().validateAndStoreLicense(
        input.organizationId,
        answer.license,
      );
      if (!result.success) throw licenseValidationError(result.error);

      return { success: true, planInfo: result.planInfo };
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
    .permission("organization:manage")
    .mutation(async ({ input }) => {
      const result = await getLicenseHandler().removeLicense(
        input.organizationId,
      );

      return {
        success: true,
        removed: result.removed,
      };
    }),
});
