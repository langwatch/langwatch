/**
 * The server half of `license.*`. Nothing here catches — every refusal below is
 * a handled error the shared path maps with its code intact.
 * Spec: enterprise/modules/licensing/specs/licensing.feature.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { LicensingApi, licenseTrpc } from "@langwatch/enterprise-licensing-contract";

/** Why the gate status is answered behind a session and no permission. */
const SSO_GATE_IS_DEPLOYMENT_WIDE =
  "the single sign-on gate is a property of the deployment, not of a tenant, so there is no scope to check against; it stays behind a session because an anonymous visitor has no business learning that an install is unlicensed";

export const licenseTrpcTransport = defineTrpcRouter(LicensingApi, licenseTrpc)
  .procedure("getStatus")
  .withPermission("organization:view")
  .handle(({ app, input }) => app.getLicenseStatus(input.organizationId))

  .procedure("getSsoGateStatus")
  .noPermission({ reason: SSO_GATE_IS_DEPLOYMENT_WIDE })
  .handle(({ app }) => app.getSsoGateStatus())

  // Which keys are acceptable is the application's: the verdict and the code
  // the presentation registry writes copy against are the domain's, not the door's.
  .procedure("upload")
  .withPermission("organization:manage")
  .handle(async ({ app, input }) => ({
    success: true as const,
    planInfo: await app.uploadLicense(input),
  }))

  // The code is the credential for one call to LangWatch and is never stored.
  .procedure("activate")
  .withPermission("organization:manage")
  .handle(async ({ app, input }) => ({
    success: true as const,
    planInfo: await app.activateLicenseWithCode(input),
  }))

  .procedure("remove")
  .withPermission("organization:manage")
  .handle(async ({ app, input }) => {
    const result = await app.removeLicense(input.organizationId);

    return { success: true as const, removed: result.removed };
  })

  .procedure("refresh")
  .withPermission("organization:manage")
  .handle(({ app, input }) => app.refreshLicense(input))

  .build();
