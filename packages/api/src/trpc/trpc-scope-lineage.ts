import {
  type AuthzDeclaration,
  type AuthzScopeLineageInput,
  PermissionDeniedError,
} from "@langwatch/authz-contract";
import { TRPCError, type TRPCMiddlewareFunction } from "@trpc/server";
import type { TrpcAuthorizationPort } from "./trpc-policy-ports.js";

type ScopeLineageMiddleware<TContext> = TRPCMiddlewareFunction<
  TContext,
  object,
  object,
  object,
  unknown
>;

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
    async ({ ctx, input, next }) => {
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
