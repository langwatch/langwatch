/**
 * The Enterprise tRPC surfaces, composed for the legacy web application's
 * router root.
 *
 * Four transports live here: licensing (`license`, `licenseEnforcement`), SCIM
 * tokens (`scimToken`), the back office's single sign-on connections
 * (`ssoConnections`) and billing (`subscription`). Each router's behaviour —
 * procedure names, input and output shapes, refusals — belongs to its Enterprise
 * feature package. What this composition owns is the wiring: which policy wraps
 * which permission, and which process capability answers each port.
 *
 * It sits in the Enterprise API composition rather than in `apps/api` because a
 * core package may not depend on an Enterprise one. Everything the process must
 * supply arrives through `create`, so this package never imports an
 * application.
 *
 * `subscription` is SaaS-only: a self-hosted installation gets an empty router
 * of the same type rather than a surface that pretends to bill.
 */
import {
  SubscriptionTrpcApi,
  type SubscriptionTrpcContext,
} from "@langwatch/enterprise-billing-server";
import {
  LicenseEnforcementTrpcApi,
  LicenseTrpcApi,
  type LicenseEnforcementTrpcContext,
  type LicenseTrpcContext,
} from "@langwatch/enterprise-licensing-server";
import {
  ScimTokenTrpcApi,
  type ScimTokenTrpcContext,
  type ScimTokenTrpcPorts,
} from "@langwatch/enterprise-scim-server";
import {
  SsoConnectionTrpcApi,
  type SsoConnectionTrpcContext,
  type SsoConnectionTrpcPorts,
} from "@langwatch/enterprise-sso-server";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";

/** Every context requirement the four surfaces place on the process. */
export type EnterpriseTrpcContext = LicenseTrpcContext &
  LicenseEnforcementTrpcContext &
  ScimTokenTrpcContext &
  SsoConnectionTrpcContext &
  SubscriptionTrpcContext;

/** One already-composed process policy, applied after a feature's input parser. */
type EnterpriseTrpcPolicy = <TProcedure>(procedure: TProcedure) => TProcedure;

/**
 * The reason the back office declares instead of an RBAC permission. It is the
 * declaration the router sweep records, so it says plainly what decides the
 * caller's reach: the staff list, and never an id in the request.
 */
export const BACK_OFFICE_NO_PERMISSION = {
  reason:
    "back-office surface gated on the ADMIN_EMAILS staff list, not on an RBAC permission; cross-tenant by design",
} as const;

/**
 * The same opt-out for the verbs whose input names an organization.
 *
 * The justification the declaration demands is the important half: the id is
 * NOT what decides the caller's reach here. An operator who is on the staff
 * list may act on any organization, and one who is not may act on none — so
 * `organizationId` is routing, saying which tenant's history the command is
 * appended to, and it is never read as a scope the caller was granted.
 */
export const BACK_OFFICE_NO_PERMISSION_FOR_ORGANIZATION = {
  ...BACK_OFFICE_NO_PERMISSION,
  allow: {
    organizationId:
      "names the tenant whose connection history the command appends to; the caller's reach is the ADMIN_EMAILS staff list and is never derived from this id",
  },
} as const;

/**
 * Why the instance's single sign-on gate status has no organization to check
 * against: it is deployment-wide and read-only for any signed-in user.
 */
export const INSTANCE_LICENSE_NO_PERMISSION = {
  reason: "instance license status is deployment-wide and read-only for any signed-in user",
} as const;

/** Explicit Enterprise tRPC transports; mounting stays application-owned. */
export class EnterpriseTrpcComposition {
  static create<
    TContext extends EnterpriseTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TScimTokenPorts extends ScimTokenTrpcPorts,
    TSsoConnectionPorts extends SsoConnectionTrpcPorts,
  >(options: {
    /** The process's one tRPC root; feature routers must not create a second. */
    root: TRPCRootObject<TContext, object, TOptions, TRoot>;
    /** The process's authenticated procedure. */
    protectedProcedure: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
    /** The process's full policy chain for one declared permission. */
    policy(permission: "organization:view" | "organization:manage"): EnterpriseTrpcPolicy;
    /** The chain declaring `INSTANCE_LICENSE_NO_PERMISSION`. */
    instanceLicensePolicy: EnterpriseTrpcPolicy;
    /** The chain declaring `BACK_OFFICE_NO_PERMISSION`. */
    backOfficePolicy: EnterpriseTrpcPolicy;
    /** The chain declaring `BACK_OFFICE_NO_PERMISSION_FOR_ORGANIZATION`. */
    backOfficePolicyForOrganization: EnterpriseTrpcPolicy;
    /** Whether this installation bills through Stripe. */
    saasBilling: boolean;
    ports: {
      scimToken: TScimTokenPorts;
      ssoConnections: TSsoConnectionPorts;
    };
  }) {
    const { root, protectedProcedure, policy, ports } = options;

    const license = LicenseTrpcApi.create(root, {
      protected: protectedProcedure,
      policy,
      unscopedPolicy: options.instanceLicensePolicy,
    });

    const licenseEnforcement = LicenseEnforcementTrpcApi.create(root, {
      protected: protectedProcedure,
      policy,
    });

    const scimToken = ScimTokenTrpcApi.create(
      root,
      { protected: protectedProcedure, policy },
      ports.scimToken,
    );

    const ssoConnections = SsoConnectionTrpcApi.create(
      root,
      {
        protected: protectedProcedure,
        staffPolicy: options.backOfficePolicy,
        staffPolicyForOrganization: options.backOfficePolicyForOrganization,
      },
      ports.ssoConnections,
    );

    const billing = SubscriptionTrpcApi.create(root, {
      protected: protectedProcedure,
      policy,
    });

    // SaaS-only: subscription management requires Stripe. Typed as the served
    // router either way, so the application router always carries the same
    // shape.
    const subscription: typeof billing = options.saasBilling
      ? billing
      : (root.router({}) as unknown as typeof billing);

    return {
      license,
      licenseEnforcement,
      scimToken,
      ssoConnections,
      subscription,
    };
  }
}
