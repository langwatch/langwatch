/**
 * ADR-092 decision 25 — the declaration marker, standalone so both the
 * declared middleware factories (`./trpc-middleware`) and the legacy
 * vocabulary module (`~/server/api/rbac`, which those factories import their
 * resolvers from) can tag middlewares without forming a cycle.
 *
 * The sweep test walks the router and refuses any procedure whose chain
 * carries no declaration; this file is the vocabulary it reads.
 */
import type { AuthzPermission, ScopeTierField } from "@langwatch/authz";

/**
 * `Symbol.for` so the sweep test and the builders agree on the key even
 * across duplicated module instances in a test graph.
 */
export const AUTHZ_DECLARATION = Symbol.for("langwatch.authz.declaration");

export type AuthzDeclaration =
  | { kind: "permission"; permission: AuthzPermission; via?: ScopeTierField }
  | { kind: "permission-any"; permissions: readonly AuthzPermission[] }
  | { kind: "no-permission"; reason: string; allow?: Record<string, string> }
  | {
      kind: "service-authorized";
      reason: string;
      permissions: readonly AuthzPermission[];
    }
  | {
      kind: "custom";
      reason: string;
      permissions: readonly AuthzPermission[];
    };

export type DeclaredAuthzMiddleware<
  M extends (params: never) => Promise<unknown>,
> = M & {
  [AUTHZ_DECLARATION]: AuthzDeclaration;
};

/**
 * Attach the declaration descriptor to a middleware. Exported so route-level
 * custom middlewares (provider validation, captured-data visibility, project
 * creation) can declare themselves too and be counted by the sweep instead
 * of allowlisted.
 */
export function declareAuthzMiddleware<
  M extends (params: never) => Promise<unknown>,
>(declaration: AuthzDeclaration, middleware: M): DeclaredAuthzMiddleware<M> {
  return Object.assign(middleware as any, {
    [AUTHZ_DECLARATION]: declaration,
  });
}

export function authzDeclarationOf(value: unknown): AuthzDeclaration | null {
  if (typeof value !== "function") return null;
  const declaration = (
    value as Partial<DeclaredAuthzMiddleware<(params: never) => Promise<unknown>>>
  )[AUTHZ_DECLARATION];
  return declaration ?? null;
}
