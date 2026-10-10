/**
 * The three access decisions, once, for both transports. `decide` runs after
 * the request is parsed and before the handler, and owns the scope-lineage
 * guard, the blank-scope-id refusal and the project-id mismatch refusal.
 */

// The permission vocabulary is `@langwatch/authorization`'s; nothing here mirrors it.
import {
  type Actor,
  applyAggregateAdminGate,
  assertProjectAcceptsWrites,
  type Authorization,
  type AuthorizationPurpose,
  BlankScopeIdError,
  PROOF_BEARING_PERMISSIONS,
  writesUnderProject,
  isPlatformTierPermission,
  permissionGrantTiers,
  PermissionDeniedError,
  SCOPE_TIER_BY_FIELD,
  SCOPE_TIER_FIELDS,
  type AuthzDeclaredScopeId,
  type AuthzHandlerScope,
  type AuthzDenialReason,
  type AuthzGetDecisionInput,
  type AuthzGetProjectAnyDecisionInput,
  type AuthzPermission,
  type AuthzScopeLineageInput,
  type AuthzScopeLineageResult,
  type DeclaredScopeTier,
  type PermissionDecision,
  type PlatformTierPermission,
  type ScopeTierField,
} from "@langwatch/authorization";
import { createLogger } from "@langwatch/observability";

import {
  EnterprisePlanRequiredError,
  PlatformPermissionDeniedError,
  PlatformSurfaceHiddenError,
  ScopeInputMismatchError,
} from "../errors.ts";
import { permissionDecisionRecord, recordPermissionDecision } from "./decision-record.ts";
import { resolveDeclaredScope } from "./declaration.ts";
import {
  AUTHZ_DECLARATION,
  declareAuthzMiddleware,
  type AuthzDeclaration,
} from "./declared-middleware.ts";
import { permissionsOfChoice, valueAtPath, type InputPermission } from "./input-permission.ts";

const logger = createLogger("langwatch:authz");

/**
 * The authz vocabulary's AND, narrowed to the two-or-more set an AND is worth
 * declaring for. Everything but the list is read off the authz member, so a
 * field added there cannot drift out of this one.
 */
export type PermissionAllDeclaration = Readonly<
  Omit<Extract<AuthzDeclaration, { kind: "permission-all" }>, "permissions"> & {
    permissions: readonly [AuthzPermission, AuthzPermission, ...AuthzPermission[]];
  }
>;

/** A permission chosen from the parsed input; `via` is where a bare entry is asked. */
export type InputPermissionDeclaration = InputPermission & Readonly<{ via?: ScopeTierField }>;

/**
 * Where a platform-tier permission is asked (E4): of the operator's PLATFORM grant. `hidden`
 * answers every refusal 404 `not_found`; `denied` is 401 or 403. `hiddenWithout` (Q42) answers
 * 404 to a caller lacking that staff permission, 403 to staff lacking this one, 401 anonymous.
 */
export type PlatformPermissionTarget = Readonly<
  | { at: "platform"; refusal?: "denied" | "hidden"; hiddenWithout?: never }
  | { at: "platform"; hiddenWithout: PlatformTierPermission; refusal?: never }
>;

/** A platform-tier permission asked at the platform, with how its refusal answers. */
export type PlatformPermissionDeclaration = Readonly<{
  kind: "permission-platform";
  permission: PlatformTierPermission;
  refusal: "denied" | "hidden";
  /** The staff permission a caller must hold before the route admits it exists (Q42). */
  hiddenWithout?: PlatformTierPermission;
}>;

export type AccessDeclaration =
  | Exclude<AuthzDeclaration, { kind: "custom" | "public" | "permission-all" }>
  | PermissionAllDeclaration
  | InputPermissionDeclaration
  | PlatformPermissionDeclaration;

export function declareAccessMiddleware<M extends (params: never) => Promise<unknown>>(
  declaration: AccessDeclaration | PublicRouteAccess,
  middleware: M,
): M {
  if (
    declaration.kind !== "permission-all" &&
    declaration.kind !== "public" &&
    declaration.kind !== "permission-by-input" &&
    declaration.kind !== "permission-platform"
  ) {
    return declareAuthzMiddleware(declaration, middleware);
  }

  const declared = ((params: never) => middleware(params)) as M;

  return Object.assign(declared, { [AUTHZ_DECLARATION]: declaration });
}

/**
 * The tiers every one of these permissions can be granted at. An AND is asked
 * at ONE scope, so a set sharing no tier is a declaration no scope can answer.
 */
export function sharedGrantTiers(
  permissions: readonly AuthzPermission[],
): readonly DeclaredScopeTier[] {
  return permissions.reduce<readonly DeclaredScopeTier[]>(
    (shared, permission) =>
      shared.filter((tier) => permissionGrantTiers(permission).includes(tier)),
    permissions[0] ? permissionGrantTiers(permissions[0]) : [],
  );
}

/**
 * Several permissions asked together, at one scope. A set that names fewer than two, repeats
 * one, or shares no tier it could all be asked at is refused where it is written.
 */
export function permissionsTogether({
  address,
  permissions,
}: {
  address: string;
  permissions: readonly AuthzPermission[];
}): readonly [AuthzPermission, AuthzPermission, ...AuthzPermission[]] {
  if (permissions.length < 2) {
    throw new Error(`${address} names ${permissions.length} permissions to check together`);
  }

  if (new Set(permissions).size !== permissions.length) {
    throw new Error(`${address} names one permission twice among the ones it checks together`);
  }

  if (sharedGrantTiers(permissions).length === 0) {
    throw new Error(
      `${address} checks ${permissions.join(" and ")} together, and no one scope grants them all`,
    );
  }

  return permissions as readonly [AuthzPermission, AuthzPermission, ...AuthzPermission[]];
}

/** Which credential reaches a REST route, as the document names it. */
export type Credential =
  | "browser"
  | "project"
  | "organization"
  | "api_key"
  | "scim_token"
  | "internal_secret"
  | "instance_admin"
  | "session_key"
  | "cli_token"
  | "otlp_ingest"
  | "licence_token"
  | "public";

/** An authenticated caller, normalized with a stable identifier for every kind. */
export type AccessActor = Actor & Readonly<{ id: string }>;

export type Caller = Readonly<{
  actor: AccessActor | null;
  scope?: AuthzDeclaredScopeId | null;
  /** A person in a browser session, the caller the second-factor gate holds (Q184). */
  browserSession?: Readonly<{ id: string | null }>;
}>;

/** The authorization decisions one request asks for; every member is required (fails closed). */
export interface Authorize {
  getDecision(input: AuthzGetDecisionInput): Promise<PermissionDecision>;
  getProjectAnyDecision(input: AuthzGetProjectAnyDecisionInput): Promise<PermissionDecision>;
  checkScopeLineage(input: AuthzScopeLineageInput): Promise<AuthzScopeLineageResult>;
  /** The organization holding a project or team (AuthzApi.getScope); null when unknown. */
  organizationOf(scope: Readonly<{ tier: "project" | "team"; id: string }>): Promise<string | null>;
  /** Whether this user holds a platform-tier permission at the PLATFORM (E4). */
  getPlatformDecision(input: {
    userId: string;
    permission: PlatformTierPermission;
  }): Promise<PlatformDecision>;
  /** A project's `kind` (ADR-177), null when unknown; every door gates with it. */
  projectKindOf(projectId: string): Promise<string | null>;
  /** AuthzApi.authorize's sealed proof for one admitted project read (ADR-166). */
  authorization(input: {
    actor: Actor;
    permission: AuthzPermission;
    projectId: string;
    purpose: AuthorizationPurpose;
  }): Promise<Authorization>;
  /** Refuses a person the organization holds at its second-factor gate. */
  assertSecondFactor(input: {
    userId: string;
    sessionId: string | null;
    organizationId: string;
    scope: AuthzDeclaredScopeId;
  }): Promise<void>;
}

/** The platform question's answer: a platform grant carries no organization role. */
export type PlatformDecision = Readonly<{ permitted: boolean }>;

/**
 * Who a platform permission is asked of: the operator behind an impersonated caller, else the
 * caller (record §8, ADR-092). Null for an actor that is no person.
 */
export function platformPrincipalOf(actor: Actor | null): string | null {
  if (actor?.type !== "user") return null;

  return actor.impersonatorId ?? actor.id;
}

/**
 * A platform-tier permission at the platform, and nowhere else; refused where it is written.
 * Returns the declaration both transports carry.
 */
export function platformPermissionOf({
  address,
  permission,
  target,
}: {
  address: string;
  permission: AuthzPermission;
  target: PlatformPermissionTarget;
}): PlatformPermissionDeclaration {
  if (!isPlatformTierPermission(permission)) {
    throw new Error(
      `${address} asks "${permission}" at the platform, and only a platform-tier permission is granted there`,
    );
  }

  const refusal = target.refusal ?? "denied";

  if (refusal !== "denied" && refusal !== "hidden") {
    throw new Error(`${address} names "${String(refusal)}", which is no platform refusal`);
  }

  const declared = {
    kind: "permission-platform",
    permission: permission as PlatformTierPermission,
    refusal,
  } as const;

  if (target.hiddenWithout === void 0) return declared;

  return { ...declared, hiddenWithout: staffPermissionOf({ address, target }) };
}

/** A staff route's own refusal is fixed, and its staff permission is granted at the platform. */
function staffPermissionOf({
  address,
  target,
}: {
  address: string;
  target: PlatformPermissionTarget;
}): PlatformTierPermission {
  const staff = target.hiddenWithout as AuthzPermission;

  if (target.refusal !== void 0) {
    throw new Error(`${address} hides from non-staff, so it names no refusal of its own`);
  }

  if (!isPlatformTierPermission(staff)) {
    throw new Error(
      `${address} hides without "${staff}", and only a platform-tier permission marks staff`,
    );
  }

  return staff as PlatformTierPermission;
}

/** A platform-tier permission asked anywhere but the platform is refused where it is written. */
export function assertNotPlatformPermission({
  address,
  permissions,
}: {
  address: string;
  permissions: readonly AuthzPermission[];
}): void {
  const platform = permissions.find((permission) => isPlatformTierPermission(permission));

  if (!platform) return;

  throw new Error(
    `${address} asks "${platform}", which is granted only at the platform: declare { at: "platform" }`,
  );
}

/** The refusal a platform route gives: the hidden family's 404, or 403 naming the permission. */
export function platformRefusal(declaration: PlatformPermissionDeclaration): Error {
  return declaration.refusal === "hidden"
    ? new PlatformSurfaceHiddenError()
    : new PlatformPermissionDeniedError(declaration.permission);
}

/**
 * Asks the platform question for one caller. An actor that is no person, or a holder the
 * process says lacks the grant, is refused; a process that cannot answer refuses too.
 */
export async function decidePlatform({
  declaration,
  actor,
  ask,
}: {
  declaration: PlatformPermissionDeclaration;
  actor: Actor | null;
  ask:
    | ((input: {
        userId: string;
        permission: PlatformTierPermission;
      }) => Promise<PlatformDecision> | PlatformDecision)
    | undefined;
}): Promise<void> {
  if (!ask) {
    throw new Error(
      `"${declaration.permission}" is asked at the platform, and this process supplied no platform decision`,
    );
  }

  const userId = platformPrincipalOf(actor);
  const holds = async (permission: PlatformTierPermission) =>
    userId ? (await ask({ userId, permission })).permitted : false;
  const staff = declaration.hiddenWithout;

  if (staff !== void 0 && !(await holds(staff))) {
    throw refusedPlatform({ actor, permission: staff, refusal: new PlatformSurfaceHiddenError() });
  }

  if (staff === declaration.permission || (await holds(declaration.permission))) return;

  throw refusedPlatform({
    actor,
    permission: declaration.permission,
    refusal: platformRefusal(declaration),
  });
}

function refusedPlatform({
  actor,
  permission,
  refusal,
}: {
  actor: Actor | null;
  permission: PlatformTierPermission;
  refusal: Error;
}): Error {
  logger.warn(
    { permission, impersonated: actor?.type === "user" && actor.impersonatorId !== undefined },
    "a platform-tier permission was refused",
  );

  return refusal;
}

/**
 * The two refusals whose concrete error class is the process's to choose: both
 * carry product copy and codes a client renders.
 */
export interface AccessDenial {
  /** The membership exists but an admin disabled it, so it grants nothing. */
  membershipDisabled(): Error;
  /** The organization role does not reach this feature at all. */
  liteMemberRestricted(resource: string): Error;
  /** A Developer seat (ADR-171) reached outside its personal project. */
  developerSeatRestricted?(resource: string): Error;
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
export type OptionalCredentialAccess = Readonly<{
  kind: "optional";
  reason: string;
  /** `"anonymous"`: a credential the door refuses is answered as none (W02, Alex 2026-10-10). */
  refused?: "anonymous";
}>;

/** Declares one route answerable with or without the family's credential. */
export function optionalCredential({
  reason,
  refused,
}: {
  reason: string;
  refused?: "anonymous";
}): OptionalCredentialAccess {
  if (reason.trim() === "") {
    throw new Error("optionalCredential needs a written reason for answering without a credential");
  }

  return Object.freeze({ kind: "optional", reason, ...(refused ? { refused } : {}) });
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
}): AuthzDeclaredScopeId {
  const named =
    typeof input === "object" && input !== null
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
  target: AuthzDeclaredScopeId;
  decision: PermissionDecision;
  denials?: AccessDenial;
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
 * The one check both runtimes run, after the parser and before the handler. Both
 * runtimes require the authorization port, so no check is skipped for want of one.
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
  authorize: Authorize;
  denials?: AccessDenial;
}): Promise<AccessDecision> {
  // A platform permission names no tenant, so no input scope is checked before it is asked.
  if (declaration.kind === "permission-platform") {
    return decidePlatformCaller({ declaration, caller, authorize });
  }

  const credentialScope = caller.scope ?? null;
  assertInputScope({ input, scope: credentialScope });

  await assertScopeLineage({ declaration, input, authorize });

  const decision = await decideDeclared({ declaration, caller, input, authorize, denials });
  for (const scope of secondFactorScopes({ declaration, input, decision })) {
    await assertSecondFactor({ caller, scope, authorize });
  }

  return decision;
}

async function decideDeclared({
  declaration,
  caller,
  input,
  authorize,
  denials,
}: {
  declaration: Exclude<AccessDeclaration, PlatformPermissionDeclaration>;
  caller: Caller;
  input: unknown;
  authorize: Authorize;
  denials: AccessDenial | undefined;
}): Promise<AccessDecision> {
  const credentialScope = caller.scope ?? null;

  switch (declaration.kind) {
    case "permission":
      return decidePermission({ declaration, caller, input, authorize, denials });
    case "permission-any":
      return decidePermissionAny({ declaration, caller, input, authorize, denials });
    case "permission-all":
      return decidePermissionAll({ declaration, caller, input, authorize, denials });
    case "permission-by-input":
      return decidePermissionByInput({ declaration, caller, input, authorize, denials });
    case "no-permission":
      assertNoSensitiveScope({ declaration, input });
      return { actor: caller.actor, scope: credentialScope };
    case "service-authorized":
      return { actor: caller.actor, scope: credentialScope };
  }
}

/**
 * Where an organization's second-factor requirement is asked, after the permit (main's mfa-gate):
 * the scope a permission was granted at, or each allowed scope a no-permission input names.
 * The service-authorized handler and the declared recovery read are not gated.
 */
function secondFactorScopes({
  declaration,
  input,
  decision,
}: {
  declaration: Exclude<AccessDeclaration, PlatformPermissionDeclaration>;
  input: unknown;
  decision: AccessDecision;
}): AuthzDeclaredScopeId[] {
  if (declaration.kind === "service-authorized") return [];
  if (declaration.kind !== "no-permission") return decision.scope ? [decision.scope] : [];
  if (declaration.mfaRecovery || typeof input !== "object" || input === null) return [];

  const named = input as Record<string, unknown>;

  return Object.keys(declaration.allow ?? {}).flatMap((field) => {
    const tier = SCOPE_TIER_BY_FIELD[field as ScopeTierField];
    const id = named[field];

    return tier !== undefined && typeof id === "string" && id !== "" ? [{ tier, id }] : [];
  });
}

export async function assertSecondFactor({
  caller,
  scope,
  authorize,
}: {
  caller: Caller;
  scope: AuthzDeclaredScopeId;
  authorize: Authorize;
}): Promise<void> {
  const session = caller.browserSession;
  if (!session || caller.actor?.type !== "user") return;

  const organizationId =
    scope.tier === "organization"
      ? scope.id
      : await authorize.organizationOf({ tier: scope.tier, id: scope.id });
  if (organizationId === null) return;

  await authorize.assertSecondFactor({
    userId: caller.actor.id,
    sessionId: session.id,
    organizationId,
    scope,
  });
}

/**
 * The scope a handler is handed: the one the door asked at, with the organization holding it
 * (Alex, 2026-10-06, lineage D1). An organization holds itself; nothing is asked for it.
 */
export async function scopeWithOrganization({
  scope,
  authorize,
}: {
  scope: AuthzDeclaredScopeId | null;
  authorize: Authorize;
}): Promise<AuthzHandlerScope | null> {
  if (scope === null) return null;
  if (scope.tier === "organization") return { ...scope, organizationId: scope.id };

  const organizationId = await authorize.organizationOf({ tier: scope.tier, id: scope.id });
  if (scope.tier === "team") return { ...scope, organizationId };

  return { ...scope, organizationId, kind: await authorize.projectKindOf(scope.id) };
}

/**
 * The security requirement a documented operation publishes for the credential
 * its route enforces. A credential no API client can present has no scheme, so
 * it is refused rather than published as "no credential required".
 */
export function securityRequirement(credential: Credential): readonly Record<string, never[]>[] {
  switch (credential) {
    case "project":
    case "api_key":
    case "session_key":
    case "otlp_ingest":
      return [{ project_api_key: [] }];
    case "organization":
      return [{ admin_api_key: [] }];
    case "scim_token":
      return [{ scim_bearer: [] }];
    case "cli_token":
      return [{ cli_access_token: [] }];
    // A deployment secret is held by an operator's own monitor rather than by
    // us, so it has a scheme for the same reason the SCIM token does.
    case "internal_secret":
      return [{ internal_secret: [] }];
    // The self-hosted operator's own key. It creates the first organization,
    // before any organization key exists to be presented instead.
    case "instance_admin":
      return [{ instance_admin_key: [] }];
    case "public":
      return [];
    case "licence_token":
    case "browser":
      throw new Error(
        `a "${credential}" route has no security scheme an API client can satisfy, ` +
          "so it cannot be advertised in the published document",
      );
  }
}

/** A platform procedure: an anonymous caller is refused as the declaration says, scope none. */
async function decidePlatformCaller({
  declaration,
  caller,
  authorize,
}: {
  declaration: PlatformPermissionDeclaration;
  caller: Caller;
  authorize: Authorize;
}): Promise<AccessDecision> {
  if (!caller.actor && declaration.refusal !== "hidden") throw new AuthenticationRequiredError();

  await decidePlatform({
    declaration,
    actor: caller.actor,
    ask: authorize.getPlatformDecision.bind(authorize),
  });

  return { actor: caller.actor, scope: null };
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
  authorize: Authorize;
  denials?: AccessDenial;
}): Promise<AccessDecision> {
  const { actor } = requireCaller(caller);

  const scope = requireDeclaredScope({
    permission: declaration.permission,
    input,
    ...(declaration.via ? { via: declaration.via } : {}),
  });

  const decision = await gatedDecision({
    decisions: authorize,
    scope,
    decision: await authorize.getDecision({
      userId: actor.id,
      permission: declaration.permission,
      scope,
    }),
  });
  recordDecision({ actor, permission: declaration.permission, scope, decision });

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
  authorize: Authorize;
  denials?: AccessDenial;
}): Promise<AccessDecision> {
  const { actor } = requireCaller(caller);
  const [first, ...rest] = declaration.permissions;

  if (!first) throw new Error("a permission-any access declaration named no permissions");

  // Always the project tier, so the field is named outright — but read through
  // the same resolution the single-permission seam uses, so the blank-versus-
  // missing split is decided in exactly one place.
  const scope = requireDeclaredScope({ permission: first, input, via: "projectId" });

  const decision = await gatedDecision({
    decisions: authorize,
    scope,
    decision: await authorize.getProjectAnyDecision({
      userId: actor.id,
      projectId: scope.id,
      permissions: [first, ...rest],
    }),
  });
  recordDecision({ actor, permission: first, scope, decision });

  if (!decision.permitted) {
    throw denied({ permission: first, scope, decision, denials });
  }

  return { actor, scope };
}

async function decidePermissionAll({
  declaration,
  caller,
  input,
  authorize,
  denials,
}: {
  declaration: PermissionAllDeclaration;
  caller: Caller;
  input: unknown;
  authorize: Authorize;
  denials?: AccessDenial;
}): Promise<AccessDecision> {
  const { actor } = requireCaller(caller);
  const [first] = declaration.permissions;

  const scope = requireDeclaredScope({
    permission: first,
    input,
    ...(declaration.via ? { via: declaration.via } : {}),
  });

  for (const permission of declaration.permissions) {
    const decision = await gatedDecision({
      decisions: authorize,
      scope,
      decision: await authorize.getDecision({ userId: actor.id, permission, scope }),
    });
    recordDecision({ actor, permission, scope, decision });

    if (!decision.permitted) throw denied({ permission, scope, decision, denials });
  }

  return { actor, scope };
}

async function decidePermissionByInput({
  declaration,
  caller,
  input,
  authorize,
  denials,
}: {
  declaration: InputPermissionDeclaration;
  caller: Caller;
  input: unknown;
  authorize: Authorize;
  denials?: AccessDenial;
}): Promise<AccessDecision> {
  const { actor } = requireCaller(caller);
  const { permission, scope: named } = chosenPermission({ declared: declaration, input });

  const scope =
    named ??
    requireDeclaredScope({
      permission,
      input,
      ...(declaration.via ? { via: declaration.via } : {}),
    });

  const decision = await gatedDecision({
    decisions: authorize,
    scope,
    decision: await authorize.getDecision({ userId: actor.id, permission, scope }),
  });
  recordDecision({ actor, permission, scope, decision });

  if (!decision.permitted) throw denied({ permission, scope, decision, denials });

  return { actor, scope };
}

/**
 * ADR-177 decision 5 on a project decision: a permitted non-admin pays one kind read and is
 * refused an aggregate; an admin and a refusal pass untouched without a read.
 */
export async function gatedDecision({
  decisions,
  scope,
  decision,
}: {
  decisions: Pick<Authorize, "projectKindOf">;
  scope: AuthzDeclaredScopeId;
  decision: PermissionDecision;
}): Promise<PermissionDecision> {
  if (scope.tier !== "project" || !decision.permitted || decision.organizationRole === "ADMIN") {
    return decision;
  }

  return applyAggregateAdminGate({ decision, kind: await decisions.projectKindOf(scope.id) });
}

/**
 * The sealed proof the door mints for an admitted project read under a proof-bearing permission
 * (ADR-166, ADR-177 block B); null for every other route, so no other route pays the mint. A
 * proof-bearing route the door cannot mint for is refused before its handler runs.
 */
export async function mintAuthorization({
  permission,
  actor,
  scope,
  authorize,
  route,
}: {
  permission: AuthzPermission | undefined;
  actor: Actor | null;
  scope: AuthzDeclaredScopeId | null;
  authorize: Authorize;
  route: string;
}): Promise<Authorization | null> {
  if (!permission || !PROOF_BEARING_PERMISSIONS.has(permission)) return null;
  if (scope?.tier !== "project" || !actor) {
    throw new PermissionDeniedError({
      permission,
      scope: scope ? { type: scope.tier, id: scope.id } : { type: "resource", id: route },
      denialReason: "no-grant",
    });
  }

  return authorize.authorization({
    actor,
    permission,
    projectId: scope.id,
    purpose: { kind: "route", route },
  });
}

/** The permissions a declaration admits under: any one admits, so any one that writes counts. */
export function declaredPermissions(declaration: AccessDeclaration): readonly AuthzPermission[] {
  switch (declaration.kind) {
    case "permission":
      return [declaration.permission];
    case "permission-any":
    case "permission-all":
      return declaration.permissions;
    default:
      return [];
  }
}

/** Whether a write is asked on an aggregate: a project-tier write, or a route that declared it. */
export function asksAggregateWrite({
  permissions,
  scope,
  refusedOnAggregate = false,
}: {
  permissions: readonly AuthzPermission[];
  scope: AuthzDeclaredScopeId | AuthzHandlerScope | null;
  refusedOnAggregate?: boolean;
}): boolean {
  return scope?.tier === "project" && (refusedOnAggregate || permissions.some(writesUnderProject));
}

/**
 * ADR-177 decision 8: a write under a project-tier permission is refused on an aggregate, and so
 * is a route that declared `refusedOnAggregate()` though its permission is exempt.
 */
export function refuseWriteUnderAggregate({
  permissions,
  scope,
  refusedOnAggregate = false,
}: {
  permissions: readonly AuthzPermission[];
  scope: AuthzHandlerScope | null;
  refusedOnAggregate?: boolean;
}): void {
  if (
    scope?.tier !== "project" ||
    !asksAggregateWrite({ permissions, scope, refusedOnAggregate })
  ) {
    return;
  }

  assertProjectAcceptsWrites({ kind: scope.kind });
}

/**
 * The permission the parsed input chose, and the scope its entry names; `null` when the entry
 * is the permission alone and is asked where the declaration's own target says.
 */
export function chosenPermission({
  declared,
  input,
}: {
  declared: InputPermission;
  input: unknown;
}): Readonly<{ permission: AuthzPermission; scope: AuthzDeclaredScopeId | null }> {
  const value = valueAtPath(input, declared.field);
  const entry =
    typeof value === "string" && Object.hasOwn(declared.map, value)
      ? declared.map[value]
      : undefined;

  // The schema refused every value the map does not name, so this is a declaration and a
  // schema that disagree: ours, never the caller's.
  if (entry === undefined) {
    logger.error({ field: declared.field }, "an input-chosen permission read an unmapped value");
    throw new AccessWiringError();
  }

  if (typeof entry === "string") return { permission: entry, scope: null };

  const id = valueAtPath(input, entry.field);

  if (typeof id === "string" && id.trim() !== "") {
    return { permission: entry.permission, scope: { tier: entry.tier, id } };
  }

  if (typeof id === "string") throw new BlankScopeIdError({ field: entry.field });

  logger.error({ field: entry.field }, "an input-chosen permission's scope field was not parsed");

  throw new AccessWiringError();
}

/**
 * What a declaration may ask the process to confirm the tenant behind the request holds. The
 * union is the runtime's own so a route cannot invent one no process answers for; each name
 * is a capability, never a field of billing's plan.
 */
export type ApiEntitlement = "enterprise" | "webhook_endpoints";

/** One declared plan question: the entitlement, the capability a refusal names, and when to ask. */
export type EntitlementGate = Readonly<{
  entitlement: ApiEntitlement;
  /** Named on the refusal's `meta.feature`, as main names the capability. */
  feature?: string;
  /** Asked only for an input this holds for; absent, every call asks. */
  when?: (input: unknown) => boolean;
  /**
   * `"permission"`: the door identifies, the plan is asked at the credential's scope, then the
   * permission (Q31: main's CLI answers 402 before 403). Absent, refused access never reaches it.
   */
  before?: "permission";
}>;

export type EntitlementOptions = Omit<EntitlementGate, "entitlement">;

/** Whether one tenant holds one entitlement, as the process reads its plans. */
export interface Entitlements {
  holds(input: { entitlement: ApiEntitlement; scope: AuthzDeclaredScopeId }): Promise<boolean>;
  /** The process's own refusal for the capability; the framework's when absent. */
  refusal?(input: { entitlement: ApiEntitlement; feature: string | undefined }): Error;
}

export async function decideEntitlement({
  gate,
  scope,
  input,
  entitlements,
  address,
}: {
  gate: EntitlementGate;
  scope: AuthzDeclaredScopeId | null;
  input: unknown;
  entitlements: Entitlements;
  address: string;
}): Promise<void> {
  if (gate.when && !gate.when(input)) return;

  const { entitlement, feature } = gate;
  if (!scope) {
    throw new Error(
      `${address} asks whether its tenant holds "${entitlement}", and access resolved no scope ` +
        "to ask it about",
    );
  }

  if (await entitlements.holds({ entitlement, scope })) return;

  throw (
    entitlements.refusal?.({ entitlement, feature }) ?? new EnterprisePlanRequiredError(feature)
  );
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
  authorize: Authorize;
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

function requireDeclaredScope({
  permission,
  input,
  via,
}: {
  permission: AuthzGetDecisionInput["permission"];
  input: unknown;
  via?: ScopeTierField;
}): AuthzDeclaredScopeId {
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
  scope: AuthzDeclaredScopeId;
  decision: PermissionDecision;
  denials?: AccessDenial;
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

  if (denials?.developerSeatRestricted && decision.organizationRole === "DEVELOPER") {
    return denials.developerSeatRestricted(permission.split(":")[0] ?? "unknown");
  }

  return new PermissionDeniedError({
    permission,
    scope: { type: scope.tier, id: scope.id },
    denialReason: denialReasonOf(decision),
  });
}

/** Every scoped decision names the operator and the subject (record: decision-record.ts). */
function recordDecision({
  actor,
  permission,
  scope,
  decision,
}: {
  actor: AccessActor;
  permission: AuthzPermission;
  scope: AuthzDeclaredScopeId;
  decision: PermissionDecision;
}): void {
  recordPermissionDecision(
    permissionDecisionRecord({
      actor,
      permission,
      scope,
      permitted: decision.permitted,
      denialReason: decision.permitted ? null : denialReasonOf(decision),
    }),
  );
}

function denialReasonOf(decision: PermissionDecision): AuthzDenialReason {
  return decision.denialReason ?? "no-grant";
}

function declaredPermissionOf(declaration: AccessDeclaration): string {
  switch (declaration.kind) {
    case "permission":
    case "permission-platform":
      return declaration.permission;
    case "permission-any":
    case "permission-all":
    case "service-authorized":
      return declaration.permissions[0] ?? "";
    case "permission-by-input":
      return permissionsOfChoice(declaration)[0] ?? "";
    case "no-permission":
      return "";
  }
}

/**
 * A credential minted while an operator acts as the user would outlive the session it came
 * from, so an endpoint declared as minting one is refused for such an actor. With no resolved
 * scope the refusal names the endpoint as the resource.
 */
export function refuseImpersonatedMint({
  permission,
  actor,
  scope,
  address,
}: {
  permission: AuthzPermission;
  actor: Actor | null;
  scope: AuthzDeclaredScopeId | null;
  address: string;
}): void {
  if (actor?.type !== "user" || !actor.impersonatorId) return;

  throw new PermissionDeniedError({
    permission,
    scope: scope ? { type: scope.tier, id: scope.id } : { type: "resource", id: address },
    denialReason: "no-grant",
  });
}
