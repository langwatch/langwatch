/**
 * The three access decisions, once, for both transports. `decide` runs after
 * the request is parsed and before the handler, and owns the scope-lineage
 * guard, the blank-scope-id refusal and the project-id mismatch refusal.
 */

// The permission and declaration vocabularies are `@langwatch/authz-contract`'s;
// nothing here mirrors them.
import type { Actor } from "@langwatch/actor";
import {
  BlankScopeIdError,
  PermissionDeniedError,
  resolveDeclaredScope,
  SCOPE_TIER_BY_FIELD,
  SCOPE_TIER_FIELDS,
  type AuthzDeclaration,
  type AuthzDeclaredScopeId,
  type AuthzDenialReason,
  type AuthzGetDecisionInput,
  type AuthzGetProjectAnyDecisionInput,
  type AuthzScopeLineageInput,
  type AuthzScopeLineageResult,
  type DeclaredScopeId,
  type PermissionDecision,
  type ScopeTierField,
} from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";

import { ScopeInputMismatchError } from "../errors.ts";

const logger = createLogger("langwatch:authz");

/**
 * What a router may declare. `custom` is deliberately absent: a custom check
 * IS its own middleware, and the one execution path has no seam for one.
 */
export type AccessDeclaration = Exclude<AuthzDeclaration, { kind: "custom" }>;

/** Which credential reaches a REST route, as the document names it. */
export type Credential =
  | "session"
  | "projectKey"
  | "organizationKey"
  | "scimToken"
  | "internalSecret"
  | "instanceAdminKey"
  | "public";

/** An authenticated caller, normalized with a stable identifier for every kind. */
export type AccessActor = Actor & Readonly<{ id: string }>;

/**
 * Who the process authenticated, and the scope its credential resolved. A door
 * that resolves a scope of its own — a project key — names it here; a door that
 * only identifies the caller leaves it null and the declaration's own input
 * names the scope instead.
 */
export type Caller = Readonly<{
  actor: AccessActor | null;
  scope?: AuthzDeclaredScopeId | null;
}>;

/** The authorization decisions one request asks for, and nothing else. */
export interface AuthorizePort {
  getDecision(input: AuthzGetDecisionInput): Promise<PermissionDecision>;
  getProjectAnyDecision(input: AuthzGetProjectAnyDecisionInput): Promise<PermissionDecision>;
  checkScopeLineage(input: AuthzScopeLineageInput): Promise<AuthzScopeLineageResult>;
}

/**
 * The two refusals whose concrete error class is the process's to choose: both
 * carry product copy and codes a client renders.
 */
export interface AccessDenialPort {
  /** The membership exists but an admin disabled it, so it grants nothing. */
  membershipDisabled(): Error;
  /** The organization role does not reach this feature at all. */
  liteMemberRestricted(resource: string): Error;
}

/** What the handler is handed beside its input. */
export type AccessDecision = Readonly<{
  actor: AccessActor | null;
  scope: AuthzDeclaredScopeId | null;
}>;

/**
 * A route that answers with no credential at all: nothing is authenticated, no
 * scope is resolved, and the handler is handed a null actor. `reason` is the
 * reviewable justification, exactly as the route registry has always demanded.
 */
export type PublicRouteAccess = Readonly<{ kind: "public"; reason: string }>;

/** Declares one route unauthenticated, with the written reason it is safe. */
export function publicRoute({ reason }: { reason: string }): PublicRouteAccess {
  if (reason.trim() === "") {
    throw new Error("publicRoute needs a written reason for answering without a credential");
  }

  return Object.freeze({ kind: "public", reason });
}

/**
 * A route the family's own door still answers: the credential is resolved and
 * its scope established, and no permission is asked of it. `reason` is the
 * reviewable justification that authentication alone is the whole gate.
 */
export type AuthenticatedRouteAccess = Readonly<{ kind: "authenticated"; reason: string }>;

/** Declares one route gated by the door alone, with the reason that suffices. */
export function anyAuthenticated({ reason }: { reason: string }): AuthenticatedRouteAccess {
  if (reason.trim() === "") {
    throw new Error("anyAuthenticated needs a written reason for asking no permission");
  }

  return Object.freeze({ kind: "authenticated", reason });
}

/**
 * A route the door answers with or without a credential: a caller presenting
 * one is resolved as ever, one presenting none is handed a null actor and a
 * null scope. `reason` is why the answer is safe to give either way.
 */
export type OptionalCredentialAccess = Readonly<{ kind: "optional"; reason: string }>;

/** Declares one route answerable with or without the family's credential. */
export function optionalCredential({ reason }: { reason: string }): OptionalCredentialAccess {
  if (reason.trim() === "") {
    throw new Error("optionalCredential needs a written reason for answering without a credential");
  }

  return Object.freeze({ kind: "optional", reason });
}

/**
 * A route whose door authenticates the caller and resolves no scope, because
 * the resource names its own owner and only the handler can look it up.
 * `reason` is why it is deferred; the handler owes the check the door skipped.
 */
export type DeferredScopeAccess = Readonly<{ kind: "deferred"; reason: string }>;

/** Declares one route's scope resolved by its handler rather than by the door. */
export function deferredScope({ reason }: { reason: string }): DeferredScopeAccess {
  if (reason.trim() === "") {
    throw new Error("deferredScope needs a written reason for resolving its scope in the handler");
  }

  return Object.freeze({ kind: "deferred", reason });
}

/** What a route may declare instead of a permission. */
export type RouteAccess =
  | PublicRouteAccess
  | AuthenticatedRouteAccess
  | OptionalCredentialAccess
  | DeferredScopeAccess;

/**
 * The scope a route's own path named, read off the parsed input. The parameter
 * is the field its tier is spelled with, so the tier comes from the name and a
 * route cannot check a project permission against a team id.
 */
export function routeScopeOf({
  param,
  input,
}: {
  param: ScopeTierField;
  input: unknown;
}): DeclaredScopeId {
  const named = typeof input === "object" && input !== null
    ? (input as Record<string, unknown>)[param]
    : undefined;

  // Present and empty is something the caller sent; absent is a declaration
  // whose path parameter and permission target disagree, which is ours.
  if (typeof named === "string" && named.trim() !== "") {
    return { tier: SCOPE_TIER_BY_FIELD[param], id: named };
  }

  if (typeof named === "string") throw new BlankScopeIdError({ field: param });

  logger.error({ param }, "a route-scoped permission named an input field the route never parsed");

  throw new AccessWiringError();
}

/**
 * The check a route asks at the scope its own path named, rather than at the
 * one its credential resolved. The decision is the process's to make; the
 * refusal is the one every other denial in the transport answers with.
 */
export function assertRouteScopePermission({
  permission,
  target,
  decision,
  denials,
}: {
  permission: AuthzGetDecisionInput["permission"];
  target: DeclaredScopeId;
  decision: PermissionDecision;
  denials?: AccessDenialPort;
}): void {
  if (decision.permitted) return;

  throw denied({ permission, scope: target, decision, denials });
}

/** An anonymous caller on a declaration that needs one. */
export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication is required");
    this.name = "AuthenticationRequiredError";
  }
}

/**
 * The input names no scope field at all. Nothing the caller did can fix that,
 * so the sentence they read says only that; which operation is miswired goes
 * to the log.
 */
export class AccessWiringError extends Error {
  constructor() {
    super("Something went wrong. Please try again.");
    this.name = "AccessWiringError";
  }
}

/**
 * Every input field that names a scope. A declaration that carries one is
 * asking a question about a tenant, which is why a public route may declare
 * none of them.
 */
export const SCOPE_INPUT_FIELDS = Object.values(SCOPE_TIER_FIELDS) as readonly ScopeTierField[];

/**
 * The one check both runtimes run, after the parser and before the handler.
 * A declaration whose check needs a port the process did not supply is refused
 * by name rather than passed.
 */
export async function decide({
  declaration,
  caller,
  input,
  authorize,
  denials,
}: {
  declaration: AccessDeclaration;
  caller: Caller;
  input: unknown;
  authorize?: AuthorizePort;
  denials?: AccessDenialPort;
}): Promise<AccessDecision> {
  const credentialScope = caller.scope ?? null;
  assertInputScope({ input, scope: credentialScope });

  if (authorize) await assertScopeLineage({ declaration, input, authorize });

  switch (declaration.kind) {
    case "permission":
      return decidePermission({ declaration, caller, input, authorize, denials });
    case "permission-any":
      return decidePermissionAny({ declaration, caller, input, authorize, denials });
    case "no-permission":
      assertNoSensitiveScope({ declaration, input });
      return { actor: caller.actor, scope: credentialScope };
    case "service-authorized":
      return { actor: caller.actor, scope: credentialScope };
  }
}

/**
 * The security requirement a documented operation publishes for the credential
 * its route enforces. A credential no API client can present has no scheme, so
 * it is refused rather than published as "no credential required".
 */
export function securityRequirement(credential: Credential): readonly Record<string, never[]>[] {
  switch (credential) {
    case "projectKey":
      return [{ project_api_key: [] }];
    case "organizationKey":
      return [{ admin_api_key: [] }];
    case "scimToken":
      return [{ scim_bearer: [] }];
    // A deployment secret is held by an operator's own monitor rather than by
    // us, so it has a scheme for the same reason the SCIM token does.
    case "internalSecret":
      return [{ internal_secret: [] }];
    // The self-hosted operator's own key. It creates the first organization,
    // before any organization key exists to be presented instead.
    case "instanceAdminKey":
      return [{ instance_admin_key: [] }];
    case "public":
      return [];
    case "session":
      throw new Error(
        `a "${credential}" route has no security scheme an API client can satisfy, ` +
          "so it cannot be advertised in the published document",
      );
  }
}

async function decidePermission({
  declaration,
  caller,
  input,
  authorize,
  denials,
}: {
  declaration: Extract<AccessDeclaration, { kind: "permission" }>;
  caller: Caller;
  input: unknown;
  authorize?: AuthorizePort;
  denials?: AccessDenialPort;
}): Promise<AccessDecision> {
  const { actor } = requireCaller(caller);
  const decisions = requireAuthorize({ authorize, kind: declaration.kind });

  const scope = requireDeclaredScope({
    permission: declaration.permission,
    input,
    ...(declaration.via ? { via: declaration.via } : {}),
  });

  const decision = await decisions.getDecision({
    userId: actor.id,
    permission: declaration.permission,
    scope,
  });

  if (!decision.permitted) {
    throw denied({ permission: declaration.permission, scope, decision, denials });
  }

  return { actor, scope };
}

async function decidePermissionAny({
  declaration,
  caller,
  input,
  authorize,
  denials,
}: {
  declaration: Extract<AccessDeclaration, { kind: "permission-any" }>;
  caller: Caller;
  input: unknown;
  authorize?: AuthorizePort;
  denials?: AccessDenialPort;
}): Promise<AccessDecision> {
  const { actor } = requireCaller(caller);
  const decisions = requireAuthorize({ authorize, kind: declaration.kind });
  const [first, ...rest] = declaration.permissions;

  if (!first) throw new Error("a permission-any access declaration named no permissions");

  // Always the project tier, so the field is named outright — but read through
  // the same resolution the single-permission seam uses, so the blank-versus-
  // missing split is decided in exactly one place.
  const scope = requireDeclaredScope({ permission: first, input, via: "projectId" });

  const decision = await decisions.getProjectAnyDecision({
    userId: actor.id,
    projectId: scope.id,
    permissions: [first, ...rest],
  });

  if (!decision.permitted) {
    throw denied({ permission: first, scope, decision, denials });
  }

  return { actor, scope };
}

/**
 * Refuses a request whose scope ids do not share one organization. AuthZ
 * resolves the lineage through its own repository and fails closed; this seam
 * is input extraction and error shaping only.
 */
async function assertScopeLineage({
  declaration,
  input,
  authorize,
}: {
  declaration: AccessDeclaration;
  input: unknown;
  authorize: AuthorizePort;
}): Promise<void> {
  const lineage = await authorize.checkScopeLineage(
    typeof input === "object" && input !== null ? (input as AuthzScopeLineageInput) : {},
  );

  if (lineage.kind === "consistent") return;

  const { widest } = lineage;

  throw new PermissionDeniedError({
    permission: declaredPermissionOf(declaration),
    scope: { type: widest.tier, id: widest.id },
    denialReason: "no-membership",
  });
}

/**
 * Refuses an input scope id that disagrees with the scope the credential
 * itself resolved. The credential is the authority; the body is a claim. The
 * field compared is the one the credential's own tier is spelled with, so a
 * project door reads `projectId` and an organization door reads
 * `organizationId`.
 */
function assertInputScope({
  input,
  scope,
}: {
  input: unknown;
  scope: AuthzDeclaredScopeId | null;
}): void {
  if (!scope) return;

  if (typeof input !== "object" || input === null) return;

  const field = SCOPE_TIER_FIELDS[scope.tier];
  const named = (input as Record<string, unknown>)[field];

  if (typeof named === "string" && named !== scope.id) {
    // Names the field and nothing else: which scope the credential DOES cover
    // is the question this refusal exists to withhold.
    throw new ScopeInputMismatchError(field);
  }
}

/**
 * Deliberately unchecked, and still refusing every scope field the
 * declaration did not individually allow with a reason.
 */
function assertNoSensitiveScope({
  declaration,
  input,
}: {
  declaration: Extract<AccessDeclaration, { kind: "no-permission" }>;
  input: unknown;
}): void {
  if (typeof input !== "object" || input === null) return;

  const allowed = Object.keys(declaration.allow ?? {});

  for (const field of SCOPE_INPUT_FIELDS) {
    if (field in input && !allowed.includes(field)) {
      throw new Error(`${field} is not allowed to be used without permission check`);
    }
  }
}

function requireCaller(caller: Caller): { actor: AccessActor } {
  if (!caller.actor) throw new AuthenticationRequiredError();

  return { actor: caller.actor };
}

function requireAuthorize({
  authorize,
  kind,
}: {
  authorize: AuthorizePort | undefined;
  kind: AccessDeclaration["kind"];
}): AuthorizePort {
  if (authorize) return authorize;

  throw new Error(
    `a "${kind}" access declaration needs an authorization port, and this surface supplied none`,
  );
}

function requireDeclaredScope({
  permission,
  input,
  via,
}: {
  permission: AuthzGetDecisionInput["permission"];
  input: unknown;
  via?: ScopeTierField;
}): DeclaredScopeId {
  const resolution = resolveDeclaredScope({
    permission,
    input: (typeof input === "object" && input !== null ? input : {}) as Partial<
      Record<ScopeTierField, unknown>
    >,
    ...(via ? { via } : {}),
  });

  if (resolution.resolved) return resolution.scope;

  // A field that is present and empty is something the caller can fix; a field
  // that is absent is a wiring bug the types were supposed to make unreachable.
  if (resolution.unresolved.reason === "blank") {
    throw new BlankScopeIdError({ field: resolution.unresolved.field });
  }

  logger.error({ permission, via }, "declared permission's input carries no usable scope id");

  throw new AccessWiringError();
}

/**
 * The one denial shape for every tier. An id that resolves to nothing answers
 * exactly like an id the caller may not touch, so no probe can learn whether a
 * scope exists.
 */
function denied({
  permission,
  scope,
  decision,
  denials,
}: {
  permission: AuthzGetDecisionInput["permission"];
  scope: DeclaredScopeId;
  decision: PermissionDecision;
  denials?: AccessDenialPort;
}): Error {
  // Checked before the role, because a disabled member HAS a role and every
  // role-shaped answer would be wrong for them.
  if (denials && decision.denialReason === "membership-disabled") {
    return denials.membershipDisabled();
  }

  // String comparison on purpose: a value import of the organization role enum
  // would put the generated Prisma client on this module's graph for one
  // constant.
  if (denials && decision.organizationRole === "EXTERNAL") {
    return denials.liteMemberRestricted(permission.split(":")[0] ?? "unknown");
  }

  return new PermissionDeniedError({
    permission,
    scope: { type: scope.tier, id: scope.id },
    denialReason: denialReasonOf(decision),
  });
}

function denialReasonOf(decision: PermissionDecision): AuthzDenialReason {
  return decision.denialReason ?? "no-binding";
}

function declaredPermissionOf(declaration: AccessDeclaration): string {
  switch (declaration.kind) {
    case "permission":
      return declaration.permission;
    case "permission-any":
    case "service-authorized":
      return declaration.permissions[0] ?? "";
    case "no-permission":
      return "";
  }
}
