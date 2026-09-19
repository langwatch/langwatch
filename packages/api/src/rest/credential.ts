/**
 * Who a REST request arrived as: the project and credential a door resolves, the principal
 * a second permission question is asked with, the scope a handler reads back, and the person
 * a personal-workspace key stands for.
 */
import { HandledError, remediation } from "@langwatch/handled-error";
import type { Context, ErrorHandler } from "hono";

import type { EndpointVariables, ServiceContext } from "./response.ts";

// The project and the credential a REST request arrives with. These are the
// project and API-key contracts' own values — described rather than imported to
// avoid a declaration cycle. The structural check is field for field.

/**
 * Who a project is, and nothing about how it is configured — the value the
 * project contract publishes as its identity. A handler that needs
 * configuration asks the project service for it.
 */
export type RestProjectIdentity = {
  id: string;
  name: string;
  slug: string;
  teamId: string;
  organizationId: string;
  /** Whether the workspace belongs to exactly one person. */
  isPersonal: boolean;
  /** That person, when the workspace is personal. */
  ownerUserId: string | null;
};

/**
 * The credential a project-scoped door resolved: a scoped API key, or the
 * legacy project key, which predates RBAC and carries full project access by
 * its class alone.
 */
export type RestResolvedProjectCredential =
  | {
      type: "legacyProjectKey";
      project: RestProjectIdentity;
    }
  | {
      type: "apiKey";
      apiKeyId: string;
      userId: string | null;
      organizationId: string;
      ingestSourceType: string | null;
      ingestionTemplateId: string | null;
      /** Set when the key belongs to an agent session rather than a person. */
      isLangySessionKey?: boolean;
      project: RestProjectIdentity;
    };

/**
 * The credential an organization-scoped door resolved. It names no project: a
 * permission asked of it is asked at organization, team or route-project scope.
 */
export type RestResolvedOrganizationCredential = {
  type: "apiKey-org";
  apiKeyId: string;
  userId: string | null;
  organizationId: string;
};

/**
 * The credential a deployment-secret door resolved. It names no tenant — the secret belongs
 * to the deployment, not a customer — so it carries no scope and no actor, only WHICH secret
 * admitted the request, by name and never by value, so an admitting door is reviewable.
 */
export type RestResolvedInternalCredential = Readonly<{
  type: "internalSecret";
  secretName: string;
}>;

// ─────────────────────────────────────────────────────────────────────────────
// The request context a scoped family sees, written by the process's own
// authentication.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `project` is the project identity — the same value the resolved credential
 * carries, so the credential a request arrives with and the project a handler
 * reads agree by construction.
 */
export type AppRestProjectVariables = {
  project: RestProjectIdentity;
  apiKeyId?: string;
  apiKeyUserId?: string;
  apiKeyOrganizationId?: string;
  /**
   * The full resolved credential. Always set by the unified authentication middleware;
   * optional here only because other middleware sharing this shape don't set it. Handlers
   * needing WHICH kind of credential called (scoped key vs legacy project key) read this.
   */
  resolvedToken?: RestResolvedProjectCredential;
};

/**
 * `organization` carries only an id because that is all an organization credential resolves
 * to: the resolved token is `{ type, apiKeyId, userId, organizationId }`, and the
 * organization feature publishes no scalar organization value.
 */
export type AppRestOrganizationVariables = {
  organization: { id: RestResolvedOrganizationCredential["organizationId"] };
  apiKeyId: string;
  apiKeyUserId: string | null;
  apiKeyOrganizationId: string;
  orgResolvedToken: RestResolvedOrganizationCredential;
};

// The credential a REST request arrived with. Handlers that ask secondary permission
// questions ("may this caller also see costs?") need to ask them about the resolved
// credential, not the declared permission checked before the handler runs.

/**
 * The credential a project-scoped door resolved: a scoped key, or the legacy project key
 * carrying full project access by its class alone. `isLangySessionKey` rides along because
 * an agent's write is labelled apart from a person's, and that fact lives on the key.
 */
export type RestProjectCredentialPrincipal =
  | Readonly<{
      kind: "apiKey";
      apiKeyId: string;
      userId: string | null;
      organizationId: string;
      projectId: string;
      teamId: string;
      isLangySessionKey?: boolean;
    }>
  | Readonly<{ kind: "legacyProjectKey" }>;

/**
 * The credential an organization-scoped door resolved. Its own arm rather than
 * the project one with blank ids: an organization key names no project, and a
 * permission asked of it is asked at organization, team or route-project scope.
 */
export type RestOrganizationCredentialPrincipal = Readonly<{
  kind: "organizationApiKey";
  apiKeyId: string;
  userId: string | null;
  organizationId: string;
}>;

export type RestCredentialPrincipal =
  | RestProjectCredentialPrincipal
  | RestOrganizationCredentialPrincipal;

/** The principal a resolved token stands for. */
export function credentialPrincipalOfToken(
  resolved: RestResolvedProjectCredential,
): RestProjectCredentialPrincipal {
  if (resolved.type !== "apiKey") return { kind: "legacyProjectKey" };

  return {
    kind: "apiKey",
    apiKeyId: resolved.apiKeyId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
    projectId: resolved.project.id,
    teamId: resolved.project.teamId,
    ...(resolved.isLangySessionKey === undefined
      ? {}
      : { isLangySessionKey: resolved.isLangySessionKey }),
  };
}

/** The principal a resolved organization token stands for. */
export function organizationCredentialPrincipalOfToken(
  resolved: RestResolvedOrganizationCredential,
): RestOrganizationCredentialPrincipal {
  return {
    kind: "organizationApiKey",
    apiKeyId: resolved.apiKeyId,
    userId: resolved.userId,
    organizationId: resolved.organizationId,
  };
}

/**
 * The principal behind a framework-authenticated project request. Raises rather than
 * guessing: a handler asking this on an unauthenticated request is a mis-wired route. Throws
 * plain `Error` (degrades to generic unknown per ADR-045) so it logs loudly.
 */
export function credentialPrincipalOf(c: Context): RestProjectCredentialPrincipal {
  const resolved = c.get("resolvedToken") as RestResolvedProjectCredential | undefined;

  if (!resolved) {
    throw new Error(
      "A handler asked for the request's credential principal with no resolved credential — mount the project authentication middleware before it",
    );
  }

  return credentialPrincipalOfToken(resolved);
}

/**
 * The principal behind a framework-authenticated organization request. Raises
 * for the reason its project sibling does: a door that resolved no credential
 * is mis-wired, and a blank principal widens the question instead of failing.
 */
export function organizationCredentialPrincipalOf(c: Context): RestOrganizationCredentialPrincipal {
  const resolved = c.get("orgResolvedToken") as RestResolvedOrganizationCredential | undefined;

  if (!resolved) {
    throw new Error(
      "A handler asked for the request's organization credential principal with no resolved credential — mount the organization authentication middleware before it",
    );
  }

  return organizationCredentialPrincipalOfToken(resolved);
}

// ─────────────────────────────────────────────────────────────────────────────
// What the process's doors resolved for one request, as a module reads it back when binding
// a fact. Keyed by request (not context) so a door remains unable to touch handler variables.
// The answer is the door's: resolving twice would ask the key store a second time per request.

/** Who a browser cookie was verified as, for a family that binds it as a fact. */
export type RestBrowserCaller = Readonly<{ userId: string | null }>;

/**
 * What the SCIM door resolved: the token's own id (the actor), the
 * organization it was minted for (the scope), and the directory connection
 * it belongs to, when it belongs to one.
 */
export type RestResolvedScimCredential = Readonly<{
  id: string;
  organizationId: string;
  connectionId: string | null;
}>;

const projectCredentials = new WeakMap<Request, RestResolvedProjectCredential>();
const organizationCredentials = new WeakMap<Request, RestResolvedOrganizationCredential>();
const scimCredentials = new WeakMap<Request, RestResolvedScimCredential>();
const browserCallers = new WeakMap<Request, RestBrowserCaller>();

/** The project door states what it resolved, once per request. */
export function recordProjectCredential(
  request: Request,
  credential: RestResolvedProjectCredential,
): void {
  projectCredentials.set(request, credential);
}

/** The organization door states what it resolved, once per request. */
export function recordOrganizationCredential(
  request: Request,
  credential: RestResolvedOrganizationCredential,
): void {
  organizationCredentials.set(request, credential);
}

/** The SCIM door states what it resolved, once per request. */
export function recordScimCredential(
  request: Request,
  credential: RestResolvedScimCredential,
): void {
  scimCredentials.set(request, credential);
}

/** The byte door states who it verified, once per request. */
export function recordBrowserCaller(request: Request, caller: RestBrowserCaller): void {
  browserCallers.set(request, caller);
}

/**
 * What the project door resolved for this request. Raises rather than guessing: no resolved
 * credential is a wiring bug. Throws plain `Error` (degrades to generic unknown per ADR-045).
 */
export function projectCredentialOfRequest(request: Request): RestResolvedProjectCredential {
  const credential = projectCredentials.get(request);

  if (!credential) {
    throw new Error(
      "A module bound a fact from the project credential, and this request's door resolved none",
    );
  }

  return credential;
}

/** The same, for the organization door. */
export function organizationCredentialOfRequest(
  request: Request,
): RestResolvedOrganizationCredential {
  const credential = organizationCredentials.get(request);

  if (!credential) {
    throw new Error(
      "A module bound a fact from the organization credential, and this request's door resolved none",
    );
  }

  return credential;
}

/** The same, for the SCIM door. */
export function scimCredentialOfRequest(request: Request): RestResolvedScimCredential {
  const credential = scimCredentials.get(request);

  if (!credential) {
    throw new Error(
      "A module bound a fact from the SCIM credential, and this request's door resolved none",
    );
  }

  return credential;
}

/**
 * Who the byte door verified, or nobody. Answers `null` rather than raising:
 * every family that binds this one declares its own 401, and an optional door
 * that admitted an anonymous caller is not a wiring bug.
 */
export function browserCallerOfRequest(request: Request): RestBrowserCaller | null {
  return browserCallers.get(request) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The scope a request arrived on, read off a handler's own context — typed
// once, instead of `c.get("project") as ProjectIdentity` in every family.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A context that can answer for one variable. Structural rather than a whole
 * `ServiceContext`: Hono's context is INVARIANT in its variables map, so a
 * parameter naming one map would refuse every family with its own provider.
 */
type ScopeReader<TKey extends string, TValue> = {
  get(key: TKey): TValue | undefined;
};

/** A handler context on a family whose door resolved a project. */
export type ProjectScopedContext<
  TVariables extends Record<string, unknown> = EndpointVariables,
  TApp = unknown,
> = ServiceContext<TVariables & Partial<AppRestProjectVariables>, TApp>;

/** A handler context on a family whose door resolved an organization. */
export type OrganizationScopedContext<
  TVariables extends Record<string, unknown> = EndpointVariables,
  TApp = unknown,
> = ServiceContext<TVariables & Partial<AppRestOrganizationVariables>, TApp>;

/**
 * The project this request is scoped to. It throws rather than answering
 * `undefined` when the door did not run: a handler reading a missing project
 * would query with a blank id, which widens the read rather than refusing.
 */
export function projectOf(
  context: ScopeReader<"project", AppRestProjectVariables["project"]>,
): AppRestProjectVariables["project"] {
  const project = context.get("project");

  if (!project) {
    throw new Error(
      "No project on the request context: this route is not on a project-scoped family, " +
        "or its own door did not run",
    );
  }

  return project;
}

/** The organization this request is scoped to. @see projectOf */
export function organizationOf(
  context: ScopeReader<"organization", AppRestOrganizationVariables["organization"]>,
): AppRestOrganizationVariables["organization"] {
  const organization = context.get("organization");

  if (!organization) {
    throw new Error(
      "No organization on the request context: this route is not on an organization-scoped " +
        "family, or its own door did not run",
    );
  }

  return organization;
}

/**
 * A family's own `onError`, and the boundary one is handed — Hono's shape,
 * re-exported so a feature package needs no dependency on Hono to name the
 * argument its `errorHandler` takes.
 */
export type RestErrorHandler = ErrorHandler;

// Personal-workspace API key checks: `/api/me/usage` and PR usage both need the same
// two guards. A legacy key carries no user (IS the workspace key), while a modern key with
// no user is a service key (minted for a job), so the guard takes the whole credential.

/**
 * The calling key belongs to a workspace that is not one person's. Handled rather than a
 * plain `Error`: we know exactly what is wrong, and the caller has one step to take — use
 * the key from their own personal workspace.
 */
export class PersonalProjectKeyRequiredError extends HandledError {
  declare readonly code: "personal_project_key_required";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "personal_project_key_required",
      "This endpoint requires a personal-workspace API key. Use the API key from your own personal workspace.",
      {
        httpStatus: 400,
        fault: "customer",
        ...remediation("personal_project_key_required"),
        ...options,
      },
    );

    this.name = "PersonalProjectKeyRequiredError";
  }
}

/**
 * The calling key belongs to a user who does not own the personal workspace it is pointed
 * at. Nothing identifies the owner, on the error or in `meta`: whose workspace this is
 * answers the very question the refusal exists to withhold.
 */
export class PersonalUsageKeyMismatchError extends HandledError {
  declare readonly code: "personal_usage_key_mismatch";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "personal_usage_key_mismatch",
      "This API key cannot read another user's personal workspace. Use a key scoped to your own personal workspace.",
      {
        httpStatus: 403,
        fault: "customer",
        ...remediation("personal_usage_key_mismatch"),
        ...options,
      },
    );

    this.name = "PersonalUsageKeyMismatchError";
  }
}

/**
 * The calling credential is a service key, which stands for no person. A personal read has
 * to name whose data it answers for; answering with the workspace's owner would hand the
 * key its creator's identity rather than its own.
 */
export class PersonalUsageServiceKeyUnsupportedError extends HandledError {
  declare readonly code: "personal_usage_service_key_unsupported";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "personal_usage_service_key_unsupported",
      "This endpoint answers for one person, so a service API key cannot read it. Use an API key issued to you.",
      {
        httpStatus: 403,
        fault: "customer",
        ...remediation("personal_usage_service_key_unsupported"),
        ...options,
      },
    );

    this.name = "PersonalUsageServiceKeyUnsupportedError";
  }
}

/**
 * The user whose data a personal-workspace read answers for. Takes the resolved credential
 * (not just loose ids from context) because the credential's CLASS is half the decision.
 */
export function resolvePersonalCaller({
  project,
  credential,
}: {
  project: { isPersonal: boolean | null; ownerUserId: string | null };
  credential: RestCredentialPrincipal;
}): string {
  if (!project.isPersonal || !project.ownerUserId) {
    throw new PersonalProjectKeyRequiredError();
  }

  if (credential.kind === "legacyProjectKey") {
    return project.ownerUserId;
  }

  if (credential.userId === null) {
    throw new PersonalUsageServiceKeyUnsupportedError();
  }

  if (credential.userId !== project.ownerUserId) {
    throw new PersonalUsageKeyMismatchError();
  }

  return project.ownerUserId;
}

// ─────────────────────────────────────────────────────────────────────────────
// The session a request carries, READ and never enforced.
// ─────────────────────────────────────────────────────────────────────────────

/** Who a verified browser cookie stands for, as anything reading one sees it. */
export type SessionCaller = Readonly<{
  /** The signed-in person, absent for a verified cookie with no live session. */
  userId?: string | undefined;
  email?: string | undefined;
  name?: string | null | undefined;
  image?: string | null | undefined;
  /** Who is acting as them, where somebody is. */
  impersonator?:
    | Readonly<{
        id?: string | undefined;
        name?: string | null | undefined;
        email?: string | null | undefined;
        image?: string | null | undefined;
      }>
    | undefined;
  /** The project a key-credentialled caller stands for, where one did. */
  apiKeyProjectId?: string | undefined;
  /** The live session's own id, where the deployment tracks one. */
  sessionId?: string | undefined;
  /** The RAW verified auth-session id, before any live-session lookup. */
  authSessionId?: string | undefined;
}>;

/**
 * The half of session verification no module can do — reading and verifying
 * this deployment's own cookie — joined to the half only the auth module can.
 * Composed once; nothing holds either half on its own.
 */
export type SessionVerification = (request: Request) => Promise<SessionCaller | null>;

/**
 * Reads the session a request carries, and nothing else.
 *
 * Its whole contract is the answer: `SessionCaller` or `null`. It refuses
 * nobody, redirects nobody and gates nothing — every enforcement path in this
 * package takes that answer and decides for itself, which is what lets the
 * browser bundle ASK who is asking without becoming a place that says no.
 */
export class SessionReader {
  /** A deployment that composed a verifier. */
  static create(options: { verify: SessionVerification }): SessionReader {
    return new SessionReader(options.verify);
  }

  /**
   * A deployment that composed none. Every read answers `null`, and each
   * reader takes its own branch — the routes still exist and refuse, rather
   * than an unverified caller being let through.
   */
  static unverified(): SessionReader {
    return new SessionReader(void 0);
  }

  /**
   * One answer per request, however many readers ask: some routes resolve
   * nobody and still need a session, and verifying once avoids four round
   * trips to the session store for one request.
   */
  readonly #answers = new WeakMap<Request, Promise<SessionCaller | null>>();

  private constructor(private readonly verify: SessionVerification | undefined) {}

  /** Whether this deployment composed anything at all behind the cookie. */
  get verifies(): boolean {
    return this.verify !== void 0;
  }

  read(request: Request): Promise<SessionCaller | null> {
    const already = this.#answers.get(request);
    if (already) return already;

    const answering = this.verify?.(request) ?? Promise.resolve(null);
    this.#answers.set(request, answering);

    return answering;
  }
}
