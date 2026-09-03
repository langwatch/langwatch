/**
 * ADR-092 decision 25 — the declaration marker. In the package so every
 * framework (the tRPC declared middleware factories, the legacy vocabulary
 * module, any future surface) shares one vocabulary without forming a cycle,
 * and so `DeclaredAuthzMiddleware` can brand what `.use()` accepts.
 *
 * The sweep test walks the router and refuses any procedure whose chain
 * carries no declaration; this file is the vocabulary it reads.
 */
import type { ScopeTierField } from "./declaration";
import type { AuthzPermission } from "./registry";

/**
 * `Symbol.for` so the sweep test and the builders agree on the key even
 * across duplicated module instances in a test graph.
 */
export const AUTHZ_DECLARATION = Symbol.for("langwatch.authz.declaration");

/**
 * The machine-readable claim a resolver-authorized declaration makes about
 * each scope id its resolver enforces: the field, and WHAT enforces it —
 * the assertion or filter, named so a reviewer can find and judge it. The
 * sweep counts a claimed field as covered, exactly as `.noPermission()`'s
 * `allow` names a reason per field; an unclaimed scope id still fails CI.
 */
export type EnforcedScopeFields = Partial<Record<ScopeTierField, string>>;

export type AuthzDeclaration =
  | { kind: "permission"; permission: AuthzPermission; via?: ScopeTierField }
  | { kind: "permission-any"; permissions: readonly AuthzPermission[] }
  | { kind: "no-permission"; reason: string; allow?: Record<string, string> }
  | {
      kind: "service-authorized";
      reason: string;
      permissions: readonly AuthzPermission[];
      enforces?: EnforcedScopeFields;
    }
  | {
      kind: "custom";
      reason: string;
      permissions: readonly AuthzPermission[];
      enforces?: EnforcedScopeFields;
    };

export type DeclaredAuthzMiddleware<M extends (params: never) => Promise<unknown>> = M & {
  [AUTHZ_DECLARATION]: AuthzDeclaration;
};

/**
 * Attach the declaration descriptor to a middleware. Exported so route-level
 * custom middlewares (provider validation, captured-data visibility, project
 * creation) can declare themselves too and be counted by the sweep instead
 * of allowlisted.
 */
export function declareAuthzMiddleware<M extends (params: never) => Promise<unknown>>(
  declaration: AuthzDeclaration,
  middleware: M,
): DeclaredAuthzMiddleware<M> {
  // Wrap rather than stamp the passed function: `Object.assign(middleware, …)`
  // mutates the caller's object, so declaring one shared middleware instance
  // twice with different descriptors would leave both procedures reporting the
  // last, and the sweep would read the wrong declaration for the first. A
  // fresh wrapper carries this declaration and nothing else's.
  const declared = ((params: never) => middleware(params)) as M;
  return Object.assign(declared, {
    [AUTHZ_DECLARATION]: declaration,
  }) as DeclaredAuthzMiddleware<M>;
}

export function authzDeclarationOf(value: unknown): AuthzDeclaration | null {
  if (typeof value !== "function") return null;
  const declaration = (
    value as Partial<DeclaredAuthzMiddleware<(params: never) => Promise<unknown>>>
  )[AUTHZ_DECLARATION];
  return declaration ?? null;
}
