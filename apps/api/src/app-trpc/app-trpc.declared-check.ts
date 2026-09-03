/**
 * One declaration, one middleware.
 *
 * `AppTrpcPolicyMiddlewares.declaredCheck` takes an `AuthzDeclaration` and
 * answers the middleware that enforces it. The four builders that DO the
 * enforcing are the app's — they resolve the scope from validated input, ask
 * the app's permission service, and carry the machine-readable declaration the
 * router sweep reads — so they arrive here rather than being imported.
 *
 * The mapping itself is exhaustive on purpose. A declaration kind with no
 * builder is a wiring mistake, and answering `undefined` for it would install
 * NO check while `enforcePermissionCheck` still saw a procedure that never
 * flipped `permissionChecked` — a fail-closed refusal at first call rather
 * than at composition. Throwing here moves the discovery to boot.
 */
import type {
  AuthzDeclaration,
  AuthzPermission,
  EnforcedScopeFields,
  ScopeTierField,
} from "@langwatch/authz-contract";

/**
 * The app's four declared-authz middleware builders, exactly as
 * `platform/app/src/server/app-layer/authz/trpc-middleware.ts` exports them.
 */
export type AppAuthzMiddlewareBuilders = Readonly<{
  permission(input: Readonly<{ permission: AuthzPermission; via?: ScopeTierField }>): unknown;
  permissionAny(permissions: readonly AuthzPermission[]): unknown;
  noPermission(input: Readonly<{ reason: string; allow?: Record<string, string> }>): unknown;
  serviceAuthorized(
    input: Readonly<{
      reason: string;
      permissions: readonly AuthzPermission[];
      /**
       * Per scope field, WHAT in the resolver enforces it. Forwarded rather
       * than dropped: the sweep counts a claimed field as covered, so a
       * declaration that arrives here without its claims reads as a procedure
       * taking a required scope id nothing checks.
       */
      enforces?: EnforcedScopeFields;
    }>,
  ): unknown;
}>;

/**
 * Builds the `declaredCheck` an `AppTrpcPolicyMiddlewares` needs from the
 * app's builders.
 *
 * `kind: "custom"` is deliberately unsupported: a custom check IS its own
 * middleware, written where the rule lives, so a feature that needs one hands
 * the process the middleware rather than a description of it.
 */
export function declaredCheckFrom(
  builders: AppAuthzMiddlewareBuilders,
): (declaration: AuthzDeclaration) => unknown {
  return (declaration) => {
    switch (declaration.kind) {
      case "permission":
        return builders.permission({
          permission: declaration.permission,
          via: declaration.via,
        });
      case "permission-any":
        return builders.permissionAny(declaration.permissions);
      case "no-permission":
        return builders.noPermission({
          reason: declaration.reason,
          allow: declaration.allow,
        });
      case "service-authorized":
        return builders.serviceAuthorized({
          reason: declaration.reason,
          permissions: declaration.permissions,
          ...(declaration.enforces === undefined ? {} : { enforces: declaration.enforces }),
        });
      default:
        throw new Error(
          `a ${declaration.kind} authorization declaration has no process middleware; pass the middleware itself`,
        );
    }
  };
}
