import {
  type AuthzDeclaration,
  type AuthzScopeLineageInput,
  PermissionDeniedError,
} from "@langwatch/authz-contract";
import { TRPCError } from "@trpc/server";
import type { TrpcAuthorizationPort, TrpcMiddlewareContext } from "./trpc-policy-ports.js";

/**
 * The middleware's own parameters, annotated rather than inferred.
 *
 * tRPC hands a middleware `Simplify<WithoutIndexSignature<TContext>>`, which is
 * a runtime identity for a plain object type but which the compiler cannot
 * prove assignable back to an unresolved `TContext`. So inferring `ctx` here
 * and passing it to a port that wants `TContext` fails — and it fails in a way
 * that cascades: the enclosing procedure builder stops resolving and every
 * callback downstream loses its contextual types, which reads as hundreds of
 * unrelated implicit-`any` errors in the composing app.
 *
 * `trpc-declared-authz.ts` already solves this with `TrpcDeclaredCheckParams`;
 * this is the same move for the same reason.
 */
type ScopeLineageParams<TContext> = {
  ctx: TrpcMiddlewareContext<TContext>;
  input: unknown;
  next: () => any;
};

/**
 * Deliberately NOT `TRPCMiddlewareFunction`: naming tRPC's own type in the
 * return position re-imposes the mapped context and the assignment fails
 * again. `any` in the result mirrors `DeclaredCheckNext` next door — `.use()`
 * requires a return assignable to tRPC's `MiddlewareResult`, and narrowing it
 * makes every call site a compile error.
 */
type ScopeLineageMiddleware<TContext> = (
  params: ScopeLineageParams<TContext>,
) => Promise<any>;

function asScopeLineageInput(input: unknown): AuthzScopeLineageInput {
  return typeof input === "object" && input !== null ? input : {};
}

function declaredPermissionOf(declaration: AuthzDeclaration | null): string {
  switch (declaration?.kind) {
    case "permission":
      return declaration.permission;
    case "permission-any":
    case "custom":
    case "service-authorized":
      return declaration.permissions[0] ?? "";
    default:
      return "";
  }
}

/**
 * Keeps the tRPC boundary limited to input extraction and error shaping. AuthZ
 * resolves scope lineage through its composed repository and fails closed.
 */
export function createScopeLineageGuard<TContext>(
  ports: Readonly<{ authorization: TrpcAuthorizationPort<TContext> }>,
): (declaration: AuthzDeclaration | null) => ScopeLineageMiddleware<TContext> {
  return (declaration) =>
    async ({ ctx, input, next }: ScopeLineageParams<TContext>) => {
      const lineage = await ports.authorization
        .forRequest(ctx)
        .checkScopeLineage(asScopeLineageInput(input));
      if (lineage.kind === "consistent") {
        return next();
      }

      const { widest } = lineage;
      const denied = new PermissionDeniedError({
        permission: declaredPermissionOf(declaration),
        scope: { type: widest.tier, id: widest.id },
        denialReason: "no-membership",
      });

      throw new TRPCError({
        // The handled-error middleware derives the wire status from this cause.
        code: "UNAUTHORIZED",
        message: denied.message,
        cause: denied,
      });
    };
}
