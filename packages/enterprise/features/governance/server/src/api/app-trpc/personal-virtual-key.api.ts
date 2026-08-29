/**
 * Personal virtual keys over the process's tRPC transport.
 *
 * Distinct from the organization-wide virtual-key admin surface, which gates on
 * `virtualKeys:manage` / `:rotate` / `:delete`. A personal key is authorised by
 * the caller BEING its principal user, not by RBAC: every member may mint, list
 * and revoke their OWN keys in any organization they belong to. Membership is
 * proved by the application so a caller cannot operate against an organization
 * they are not in.
 *
 * The one place a permission genuinely applies is auditing someone else's keys:
 * `virtualKeys:viewOtherPersonal` is what widens `list` past the caller's own,
 * and the declaration on `list` names it.
 *
 * ## Credentials
 *
 * `issuePersonal` returns the plaintext key once, at the moment of minting, and
 * the caller must persist it immediately. `list` never returns secret material.
 *
 * Transport only: input parsing, the wire shape of the mint response, and
 * delegation. The membership gate, the duplicate-label refusal and the typed
 * refusals all belong to {@link GovernanceApp}, which both of this feature's
 * transports reach.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type {
  AnyTRPCRootTypes,
  TRPCRootObject,
  TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { GovernanceApp } from "#app/governance.app";

/**
 * The process supplies authentication; authorization arrives as the policies.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them.
 */
export type PersonalVirtualKeyTrpcContext = Readonly<{
  app: Readonly<{ governanceApp: GovernanceApp }>;
  actor(): Readonly<{ id: string }>;
  /**
   * The signed-in user's display identity. Read only for the lazy
   * personal-workspace backfill, which names the workspace after its owner;
   * `actor()` carries the id alone.
   */
  session: Readonly<{
    user: Readonly<{ id: string; name?: string | null; email?: string | null }>;
  }> | null;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type PersonalVirtualKeyTrpcProcedures<
  TContext extends PersonalVirtualKeyTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * Tracing, logging, error shaping, scope lineage, the check and audit for one
   * declared permission, applied AFTER this feature's input parser.
   */
  policy(permission: AuthzPermission): ProcedureDecorator;
  /**
   * The declaration for a procedure whose reach the resolver decides from data
   * it loads — here, whose keys the caller may see. Records why, and which
   * permission the resolver enforces to widen it.
   */
  resolverAuthorizedPolicy(options: {
    reason: string;
    permissions: readonly AuthzPermission[];
  }): ProcedureDecorator;
}>;

const organizationScopeSchema = z.object({ organizationId: z.string() });

/** Installs the complete `personalVirtualKeys.*` tRPC surface on a process root. */
export class PersonalVirtualKeyTrpcApi {
  static create<
    TContext extends PersonalVirtualKeyTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: PersonalVirtualKeyTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy, resolverAuthorizedPolicy } = procedures;

    /** The caller, plus the display identity the lazy workspace backfill names. */
    const callerOf = (ctx: PersonalVirtualKeyTrpcContext) => ({
      id: ctx.actor().id,
      displayName: ctx.session?.user.name ?? null,
      displayEmail: ctx.session?.user.email ?? null,
    });

    return trpc.router({
      /**
       * Personal keys in an organization. Never returns the secret.
       *
       * The default surface lists the caller's OWN keys, and the principal-user
       * match is what authorises it. An administrator holding
       * `virtualKeys:viewOtherPersonal` can audit one other member's keys via
       * `targetUserId`, or sweep every member's by omitting it.
       */
      list: resolverAuthorizedPolicy({
        reason:
          "a personal key belongs to its principal, so the caller's own keys need no permission; the resolver refuses non-members and widens the result past the caller only for a holder of virtualKeys:viewOtherPersonal at this organization",
        permissions: ["virtualKeys:viewOtherPersonal"],
      })(
        procedure.input(
          z.object({
            organizationId: z.string(),
            targetUserId: z.string().optional(),
          }),
        ),
      ).query(async ({ ctx, input }) =>
        ctx.app.governanceApp.listPersonalVirtualKeys(
          { organizationId: input.organizationId, targetUserId: input.targetUserId },
          callerOf(ctx),
        ),
      ),

      /**
       * Issue a new personal key under the given label. Returns the secret
       * exactly once — the caller must persist it immediately.
       *
       * Used by the "Add a new key" drawer, and by the CLI device-flow approval
       * handler for the first personal key on first login.
       */
      issuePersonal: policy("organization:view")(
        procedure.input(
          organizationScopeSchema.extend({
            label: z
              .string()
              .min(1)
              .max(64)
              .regex(/^[a-z0-9][a-z0-9_\-]*$/, {
                message:
                  "Label must be lowercase alphanumeric, dash, or underscore (no spaces)",
              }),
            routingPolicyId: z.string().optional(),
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
        const issued = await ctx.app.governanceApp.issuePersonalVirtualKey(
          {
            organizationId: input.organizationId,
            label: input.label,
            routingPolicyId: input.routingPolicyId,
          },
          callerOf(ctx),
        );

        // The one moment the plaintext key exists on the wire.
        return {
          id: issued.virtualKey.id,
          label: issued.virtualKey.name,
          secret: issued.secret,
          baseUrl: issued.baseUrl,
          displayPrefix: issued.virtualKey.displayPrefix,
          routingPolicyId: issued.routingPolicyId,
        };
      }),

      /** Revoke one of the caller's own personal keys. Idempotent. */
      revokePersonal: policy("organization:view")(
        procedure.input(organizationScopeSchema.extend({ id: z.string() })),
      ).mutation(async ({ ctx, input }) => {
        await ctx.app.governanceApp.revokePersonalVirtualKey(
          { organizationId: input.organizationId, id: input.id },
          callerOf(ctx),
        );
        return { ok: true };
      }),
    });
  }
}
