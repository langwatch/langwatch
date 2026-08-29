/**
 * An organization's Enterprise license over the process's tRPC transport.
 *
 *   getStatus:        the license the organization is running on, its plan and
 *                     the usage it is measured against.
 *   getSsoGateStatus: why a deployment configured for single sign-on is not
 *                     using it — deployment-wide, not per organization.
 *   upload:           validates a pasted key and stores it.
 *   remove:           drops the key, returning the organization to the free
 *                     tier.
 *   generate:         mints and signs a key from a private key the operator
 *                     pastes in.
 *
 * Reading a license takes `organization:view`; changing one takes
 * `organization:manage`, because a license decides the seat and volume ceilings
 * for everybody in the organization.
 *
 * Transport only: gates, input shapes and delegation to `LicensingApp`. Every
 * process capability this surface needs that is not licensing's own — the
 * composed service instances, the resolved authentication provider, the single
 * sign-on gate, and the failure log — is a dependency of that application
 * rather than a second bag declared here, so the limit surface next door
 * reaches the same ones.
 */
import { HandledError } from "@langwatch/handled-error";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { LicensingApp } from "#app/licensing.app";

/**
 * The process supplies authentication; authorization arrives as a policy.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them.
 */
export type LicenseTrpcContext = Readonly<{
  app: Readonly<{ licensing: LicensingApp }>;
  actor(): Readonly<{ id: string }>;
}>;

type LicenseTrpcProcedures<
  TContext extends LicenseTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(
    permission: "organization:view" | "organization:manage",
  ): <TProcedure>(procedure: TProcedure) => TProcedure;
  /**
   * The same chain carrying an explicit opt-out of the permission check, for
   * `getSsoGateStatus` alone: the answer is deployment-wide, so there is no
   * organization to check it against. It stays behind a session because an
   * anonymous visitor has no business learning that an install is unlicensed.
   */
  unscopedPolicy<TProcedure>(procedure: TProcedure): TProcedure;
}>;

/**
 * Plan limits a minted license encodes: the enforced levers (member seats,
 * messages volume) plus identity. Projects, teams and experimentation
 * resources are OSS/uncapped and are not part of a license.
 */
const planLimitsSchema = z.object({
  maxMembers: z.number().int().positive("Plan limits must be positive numbers"),
  maxMembersLite: z.number().int().positive("Plan limits must be positive numbers"),
  maxMessagesPerMonth: z.number().int().positive("Plan limits must be positive numbers"),
  canPublish: z.boolean(),
  webhookEndpointsEnabled: z.boolean().optional(),
  usageUnit: z.enum(["traces", "events"]),
});

const generateLicenseSchema = z.object({
  privateKey: z.string().min(1, "Private key is required"),
  organizationName: z.string().min(1, "Organization name is required"),
  email: z.string().email("Invalid email format"),
  expiresAt: z.date(),
  planType: z.enum(["PRO", "ENTERPRISE", "CUSTOM"]),
  plan: planLimitsSchema,
});

const organizationScopeSchema = z.object({
  organizationId: z.string().min(1),
});

/** Installs the complete `license.*` tRPC surface on a process-owned root. */
export class LicenseTrpcApi {
  static create<
    TContext extends LicenseTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: LicenseTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy, unscopedPolicy } = procedures;

    return trpc.router({
      /** The current license status for an organization. */
      getStatus: policy("organization:view")(procedure.input(organizationScopeSchema)).query(
        async ({ ctx, input }) => {
          // No catch: `OrganizationNotFoundError` is a `HandledError`, so the
          // shared middleware maps it to NOT_FOUND and keeps it as the cause.
          // Re-wrapping it here threw away the code and the trace id.
          return await ctx.app.licensing.getLicenseStatus(input.organizationId);
        },
      ),

      /**
       * Why a deployment configured for single sign-on is not using it: either
       * the license gate is refusing to switch it on, or the provider never
       * mounted.
       *
       * The public environment cannot answer it: the resolved provider reports
       * "email" for an unlicensed deployment, a misconfigured one, and one that
       * never wanted single sign-on alike. Telling them apart is the whole
       * point here, because the first two are an operator watching their
       * company sign in by email with nothing on screen to say why (ADR-027
       * decided logs-only telemetry for the gate; this is a settings page, not
       * telemetry).
       *
       * `mounted` is reported separately from `licensed` because the two are
       * fixed in different places: one by activating a license, the other by
       * correcting the provider name or its client credentials. Both land in
       * email mode, which is the no-lockout guarantee working, but neither is
       * visible on the sign-in page, and an operator who cannot see them may
       * believe federation is being enforced when it is not.
       */
      getSsoGateStatus: unscopedPolicy(procedure.input(z.object({}))).query(
        async ({ ctx }) => ctx.app.licensing.getSsoGateStatus(),
      ),

      /** Uploads and validates a new license for an organization. */
      upload: policy("organization:manage")(
        procedure.input(
          z.object({
            organizationId: z.string().min(1),
            licenseKey: z.string().min(1, "License key is required"),
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
        // The refusal for an unacceptable key is the application's: the
        // service reports a `LICENSE_ERRORS` literal, and mapping that to the
        // code the presentation registry writes copy against is a decision
        // about the domain rather than about this transport.
        const planInfo = await ctx.app.licensing.uploadLicense({
          organizationId: input.organizationId,
          licenseKey: input.licenseKey,
        });

        return { success: true, planInfo };
      }),

      /** Removes the license from an organization. */
      remove: policy("organization:manage")(procedure.input(organizationScopeSchema)).mutation(
        async ({ ctx, input }) => {
          const result = await ctx.app.licensing.removeLicense(input.organizationId);

          return {
            success: true,
            removed: result.removed,
          };
        },
      ),

      /**
       * Generates a new license key. `organization:manage`, because only an
       * organization's own admins may mint one against it.
       */
      generate: policy("organization:manage")(
        procedure.input(
          z.object({ organizationId: z.string().min(1) }).merge(generateLicenseSchema),
        ),
      ).mutation(async ({ ctx, input }) => {
        const { privateKey, organizationName, email, expiresAt, planType, plan } = input;

        if (expiresAt <= new Date()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Expiration date must be in the future",
          });
        }

        try {
          // What a minted key CONTAINS — the plan template, the minted plan
          // and the issue time — is the application's, so a second door
          // cannot mint a key that means something slightly different.
          const licenseKey = ctx.app.licensing.mintLicenseKey({
            organizationId: input.organizationId,
            privateKey,
            organizationName,
            email,
            expiresAt,
            planType,
            plan,
          });

          return { licenseKey };
        } catch (error) {
          // The application has already recorded the diagnostic; what is left
          // here is the copy an operator reads, which belongs to the door that
          // answers them.
          //
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
  }
}
