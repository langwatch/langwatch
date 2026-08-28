/**
 * Personal virtual keys over the process's tRPC transport.
 *
 * Distinct from the organization-wide virtual-key admin surface, which gates on
 * `virtualKeys:manage` / `:rotate` / `:delete`. A personal key is authorised by
 * the caller BEING its principal user, not by RBAC: every member may mint, list
 * and revoke their OWN keys in any organization they belong to. Membership is
 * proved in the handler so a caller cannot operate against an organization they
 * are not in.
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
 * Transport only: input parsing, the membership and duplicate-label gates,
 * the typed-error translation, and delegation to the Governance service.
 */
import type { AuthzPermission, AuthzService } from "@langwatch/authz-contract";
import {
  NoEligibleProvidersError,
  PersonalVirtualKeyNotFoundError,
  RoutingPolicyHasNoProvidersError,
  type GovernanceService,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

type PersonalVirtualKeyApplication = Readonly<{
  governance: GovernanceService;
  organizations: Pick<OrganizationService, "ensurePersonalWorkspace">;
  /**
   * The process's permission engine. Read directly rather than through a port
   * because the one question this surface asks it — may the caller see somebody
   * else's personal keys — is a plain decision at the organization scope.
   */
  permissions: Pick<AuthzService, "getDecision">;
}>;

/** The process supplies authentication; authorization arrives as the policies. */
export type PersonalVirtualKeyTrpcContext = Readonly<{
  app: PersonalVirtualKeyApplication;
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

export type PersonalVirtualKeyTrpcPorts = Readonly<{
  /** Whether the caller belongs to this organization at all. */
  isOrganizationMember(input: { organizationId: string; userId: string }): Promise<boolean>;
  /**
   * Whether this user already has an unrevoked personal key under this label.
   *
   * The (organizationId, principalUserId, name) tuple is the personal-key
   * uniqueness contract: two members of one organization may each hold a
   * "default", but one member may not hold two.
   */
  hasActivePersonalKeyLabelled(input: {
    organizationId: string;
    userId: string;
    label: string;
  }): Promise<boolean>;
}>;

const organizationScopeSchema = z.object({ organizationId: z.string() });

/** Installs the complete `personalVirtualKeys.*` tRPC surface on a process root. */
export class PersonalVirtualKeyTrpcApi {
  static create<
    TContext extends PersonalVirtualKeyTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TPorts extends PersonalVirtualKeyTrpcPorts,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: PersonalVirtualKeyTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TPorts,
  ) {
    const { protected: procedure, policy, resolverAuthorizedPolicy } = procedures;

    /** Refuses a caller who is not in the organization they named. */
    const assertOrganizationMembership = async (input: {
      organizationId: string;
      userId: string;
    }): Promise<void> => {
      if (!(await ports.isOrganizationMember(input))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Not a member of organization ${input.organizationId}`,
        });
      }
    };

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
      ).query(async ({ ctx, input }) => {
        const callerId = ctx.actor().id;
        await assertOrganizationMembership({
          organizationId: input.organizationId,
          userId: callerId,
        });

        // Resolve which principal(s) the result is scoped to. Own keys are
        // always visible; anything wider needs viewOtherPersonal.
        let principalUserId: string | undefined;
        if (input.targetUserId === callerId) {
          principalUserId = callerId;
        } else {
          const { permitted: canViewOthers } = await ctx.app.permissions.getDecision({
            userId: callerId,
            permission: "virtualKeys:viewOtherPersonal",
            scope: { tier: "organization", id: input.organizationId },
          });
          if (input.targetUserId !== undefined) {
            if (!canViewOthers) {
              throw new TRPCError({
                code: "FORBIDDEN",
                message: "permission_denied: virtualKeys:viewOtherPersonal",
              });
            }
            principalUserId = input.targetUserId;
          } else {
            // No target: an admin sweeps the whole organization, a plain member
            // sees only their own keys.
            principalUserId = canViewOthers ? undefined : callerId;
          }
        }

        return ctx.app.governance.personalVirtualKeyList({
          userId: principalUserId,
          organizationId: input.organizationId,
        });
      }),

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
        const actor = ctx.actor();
        await assertOrganizationMembership({
          organizationId: input.organizationId,
          userId: actor.id,
        });

        // Make sure the personal workspace exists (lazy backfill for members
        // who joined before this feature shipped).
        const workspace = await ctx.app.organizations.ensurePersonalWorkspace({
          userId: actor.id,
          organizationId: input.organizationId,
          displayName: ctx.session?.user.name ?? null,
          displayEmail: ctx.session?.user.email ?? null,
        });

        // Duplicate labels are refused at the application layer.
        const duplicate = await ports.hasActivePersonalKeyLabelled({
          organizationId: input.organizationId,
          userId: actor.id,
          label: input.label,
        });
        if (duplicate) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `You already have a personal key labelled '${input.label}'`,
          });
        }

        let issued;
        try {
          issued = await ctx.app.governance.personalVirtualKeyIssue({
            userId: actor.id,
            organizationId: input.organizationId,
            personalProjectId: workspace.project.id,
            personalTeamId: workspace.team.id,
            label: input.label,
            routingPolicyId: input.routingPolicyId,
          });
        } catch (err) {
          // Default-resolution with zero accessible providers: the member
          // genuinely has nothing to route through. Answered as 409 so the CLI
          // and the /me screen can surface the actionable "ask your admin to
          // add a provider" message at mint time, instead of letting the member
          // discover the gap through a copy-pasted request that times out.
          if (err instanceof NoEligibleProvidersError) {
            throw new TRPCError({
              code: "CONFLICT",
              message: err.message,
              cause: err,
            });
          }
          // An empty routing policy the caller explicitly pinned. 422: the
          // request is well formed, but the pinned policy cannot yet serve it.
          if (err instanceof RoutingPolicyHasNoProvidersError) {
            throw new TRPCError({
              code: "UNPROCESSABLE_CONTENT",
              message: err.message,
              cause: err,
            });
          }
          throw err;
        }

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
        const actorId = ctx.actor().id;
        await assertOrganizationMembership({
          organizationId: input.organizationId,
          userId: actorId,
        });

        try {
          await ctx.app.governance.personalVirtualKeyRevoke({
            userId: actorId,
            organizationId: input.organizationId,
            virtualKeyId: input.id,
          });
        } catch (err) {
          if (err instanceof PersonalVirtualKeyNotFoundError) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: err.message,
            });
          }
          throw err;
        }
        return { ok: true };
      }),
    });
  }
}
