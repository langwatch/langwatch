/**
 * "What may I do here" — the frontend's single source of truth for the
 * CALLER's own effective permissions at one scope (ADR-092 §5/§11).
 *
 * It never answers for another principal, so membership itself is the only
 * requirement: a non-member resolves to the empty set, which is the engine's
 * no-default-access answering rather than a special case here.
 *
 * Transport only: gate, input parsing and delegation to `AuthzService`.
 */
import type { AuthzDeclaration, AuthzService } from "@langwatch/authz-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

/** The process supplies authentication; authorization arrives as `policy`. */
export type AuthzTrpcContext = Readonly<{
  app: Readonly<{ permissions: AuthzService }>;
  actor(): Readonly<{ id: string }>;
}>;

type AuthzTrpcProcedures<
  TContext extends AuthzTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one access declaration.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the check reads its scope id from the validated
   * input: tRPC runs middlewares in the order they were added, so a check
   * installed before `.input()` would see no input at all.
   */
  policy(declaration: AuthzDeclaration): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * Both scope ids are optional and neither is checked, because the answer IS
 * the caller's own standing: a scope they have no standing in resolves to the
 * empty set rather than to anything about it.
 */
const RESOLVES_OWN_STANDING: AuthzDeclaration = {
  kind: "service-authorized",
  reason:
    "resolves the caller's OWN effective permissions at the project or organization scope named; a non-member resolves to the empty set (no default access)",
  permissions: [],
};

const scopeInputSchema = z.object({
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
});

/** Installs the complete `authz.*` tRPC surface on a process-owned root. */
export class AuthzTrpcApi {
  static create<
    TContext extends AuthzTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: AuthzTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      effectivePermissions: policy(RESOLVES_OWN_STANDING)(
        procedure.input(scopeInputSchema),
      ).query(async ({ ctx, input }) => {
        // The narrower id wins: a project id names a project scope even when
        // an organization id rides along.
        const scope = await ctx.app.permissions.tryResolveScope({
          projectId: input.projectId,
          organizationId: input.projectId ? undefined : input.organizationId,
        });
        if (!scope) {
          return { scope: null, permissions: [] as string[] };
        }
        const permissions = await ctx.app.permissions.effectivePermissions({
          principal: { type: "user", id: ctx.actor().id },
          scope,
        });
        return {
          scope: { type: scope.type, id: scope.id },
          permissions,
        };
      }),
    });
  }
}
