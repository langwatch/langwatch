import type {
  Actor,
  AuthzDeclaredScopeId,
  AuthzPermission,
  PermissionDecision,
  PlatformTierPermission,
} from "@langwatch/authorization";

import type { Authorize, Entitlements, PlatformDecision } from "../access/access.ts";
import type { RestKeyKind } from "../rest/key-credential.ts";
import type { SessionVerification } from "./session-reader.ts";
import type { TransportFactBinding, TransportPeers } from "./transport-hosts.ts";

/**
 * The one door every API request passes: who is calling, and what they may do. auth binds it
 * from the peers it already holds; the process opens it before its hosts (record §4, §8).
 */

export type ApiDoor = Readonly<{
  /** Who a browser request is; the process's session reader asks it once per request. */
  sessions: SessionVerification;
  /** The decisions REST and tRPC both authorize through, and the session version tRPC carries. */
  authz: Authorize & TrpcSessionVersions;
  /** The API-key doors: a project key, an organization key, and any key with no project asked. */
  identities: Readonly<{
    project: RestIdentity;
    organization: RestIdentity;
    api_key: RestIdentity;
  }>;
  /** The plan every declared entitlement gate asks. */
  entitlements: Entitlements;
  /** Where every declared trail lands, on each transport. */
  audit: Readonly<{ rest: RestAuditSink; trpc: TrpcAuditSink }>;
}>;

type ApiDoorBinding = Readonly<{ apiDoor: ApiDoor }>;

/** The owner's one binding of the door, among the facts its own transport setup binds. */
export function bindApiDoor(door: ApiDoor): ApiDoorBinding {
  return { apiDoor: door };
}

/** An api process with no module binding the door would serve requests it cannot verify. */
export class MissingApiDoorError extends Error {
  constructor() {
    super(
      "No installed module binds the API door, so this process cannot verify a caller. " +
        'Install "auth".',
    );
    this.name = "MissingApiDoorError";
  }
}

/** Two modules bind the door, so neither can be the one that decides who is calling. */
export class DuplicateApiDoorError extends Error {
  constructor(readonly features: readonly string[]) {
    super(`The API door is bound by: ${features.join(", ")}. Exactly one module binds it.`);
    this.name = "DuplicateApiDoorError";
  }
}

/** The one door the installed modules bound; none or two refuse boot by name. */
export function openApiDoor(peers: Pick<TransportPeers, "facts">): ApiDoor {
  const bound = peers.facts.flatMap(({ feature, facts }) =>
    facts.filter(isApiDoorBinding).map(({ apiDoor }) => ({ feature, apiDoor })),
  );
  const [only, second] = bound;
  if (!only) throw new MissingApiDoorError();
  if (second) throw new DuplicateApiDoorError(bound.map(({ feature }) => feature));

  return only.apiDoor;
}

function isApiDoorBinding(binding: TransportFactBinding): binding is ApiDoorBinding {
  return "apiDoor" in binding;
}

/**
 * The credential a deployment-secret door resolved. It names no tenant — the secret belongs
 * to the deployment, not a customer — so it carries no scope and no actor, only WHICH secret
 * admitted the request, by name and never by value, so an admitting door is reviewable.
 */
export type RestResolvedInternalCredential = Readonly<{
  type: "internalSecret";
  secretName: string;
}>;

/** Who the family's own door authenticated, and what its credential resolved. */
export type RestCaller = Readonly<{
  actor: Actor | null;
  /** Null exactly on a door whose credential names no tenant. */
  scope: AuthzDeclaredScopeId | null;
  /** What a deployment-secret door resolved; absent on every tenant door. */
  internal?: RestResolvedInternalCredential;
  /** Called only after the handler answered, for a credential that records use. */
  markUsed?: () => void;
  /** What a session-bearing door resolved beside the actor; a route parses it by its schema. */
  session?: unknown;
}>;

/**
 * What one door does: authenticate a caller behind a credential kind, identify
 * one with nothing asked of it, and answer a permission at a scope a route's
 * own path named.
 */
export type RestIdentity = Readonly<{
  authenticate(input: {
    request: Request;
    /** The first of `permissions`, kept while a door asks one; a door asks every one. */
    permission: AuthzPermission;
    /** Every permission the route asks, in declared order; the first one missing refuses. */
    permissions: readonly AuthzPermission[];
    /** How far a key door asks the permission; only a route that declared one carries it. */
    reach?: "grants" | "organization";
    /**
     * The key kinds the route admits (E7): a project door refuses any other kind once the key
     * resolves and before the permission, with `KeyKindRefusedError`. Absent admits every kind.
     */
    keyKinds?: readonly RestKeyKind[];
  }): Promise<RestCaller> | RestCaller;
  /**
   * The door, opened with no permission asked of it. Only a declaration
   * carrying an `anyAuthenticated` route needs it, and a mount that supplies
   * none is refused by name.
   */
  identify?(input: {
    request: Request;
    rawBody?: string | Uint8Array;
  }): Promise<RestCaller> | RestCaller;
  /**
   * The same door, opened for a caller who may have presented nothing: it
   * answers `null` for a request carrying no credential at all, and refuses
   * one carrying a credential it will not accept.
   */
  identifyOptional?(input: { request: Request }): Promise<RestCaller | null> | RestCaller | null;
  /**
   * Whether the caller holds `permission` at the scope a route's own path
   * named. Only a declaration carrying such a route needs it, and a mount that
   * supplies none is refused by name.
   */
  authorize?(input: {
    caller: RestCaller;
    permission: AuthzPermission;
    target: AuthzDeclaredScopeId;
  }): Promise<PermissionDecision> | PermissionDecision;
  /**
   * Whether the caller holds a platform-tier permission at the PLATFORM (E4), asked of the
   * operator behind an impersonated caller. Only a declaration carrying a platform route needs
   * it, and a mount that supplies none is refused by name.
   */
  authorizePlatform?(input: {
    caller: RestCaller;
    permission: PlatformTierPermission;
  }): Promise<PlatformDecision> | PlatformDecision;
}>;

/**
 * What one finished route leaves on the trail. The runtime writes it; a route
 * that declared an action and reaches a runtime with no sink is refused at
 * mount, so a declared trail is never silently lost.
 */
export type RestAuditSink = Readonly<{
  record(row: RestAuditRow): Promise<void> | void;
}>;

/** One audit row: who, what, where, on which resource, and how it ended. */
export type RestAuditRow = Readonly<{
  actorId: string | null;
  action: string;
  scope: AuthzDeclaredScopeId | null;
  params: Readonly<Record<string, unknown>>;
  resultId: string | null;
  /** The handled error's own code, on a refusal; absent on an answer. */
  errorCode?: string;
}>;

/** One mutation on the deployment's trail, as this transport leaves it. */
export type TrpcAuditSink = Readonly<{
  record(entry: {
    userId: string;
    organizationId?: string;
    projectId?: string;
    action: string;
    args?: unknown;
    error?: Error;
    /** The resource the row is about: a declared target, else what the answer named. */
    targetKind?: string;
    targetId?: string;
    /** The human behind an impersonated call, as `impersonatorId`. */
    metadata?: Record<string, string>;
  }): Promise<void> | void;
  /**
   * The organization holding a project or team, null when none does. A procedure declaring
   * `.withAudit({ target: "organization", via })` is refused at mount by a sink without it.
   */
  organizationOf?(
    scope: Readonly<{ tier: "project" | "team"; id: string }>,
  ): Promise<string | null> | string | null;
}>;

/** Where a caller's session version is read; the authz module answers it. */
export type TrpcSessionVersions = Readonly<{
  getSessionVersion(input: { userId: string }): Promise<number>;
}>;
