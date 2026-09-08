/**
 * Who a REST request arrived as: the project and credential a door resolves,
 * the request-context variables it writes, the principal a second permission
 * question is asked with, the scope a handler reads back, and the person a
 * personal-workspace key stands for.
 */
import { HandledError, remediation } from "@langwatch/handled-error";
import type { Context, ErrorHandler } from "hono";

import type { EndpointVariables, ServiceContext } from "./response.ts";

// ─────────────────────────────────────────────────────────────────────────────
// The project and the credential a REST request arrives with, stated as the
// fields the transport reads.
//
// These are the project and API-key contracts' own values, described rather
// than imported. Those contracts declare their tRPC procedures with
// `@langwatch/api/contract`, so a transport module importing them back would
// close a declaration cycle. The process door hands in the feature's value and
// the check is structural: field for field, these are the same shapes.
// ─────────────────────────────────────────────────────────────────────────────

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
 * The credential a deployment-secret door resolved. It names no tenant — the
 * secret belongs to the deployment rather than to a customer — so a family
 * behind it is handed no scope and no actor. All it carries is WHICH of this
 * deployment's secrets admitted the request, by name and never by value, so a
 * door that admitted one is reviewable.
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
   * The full resolved credential. Always set by the unified authentication
   * middleware; optional here because other middleware sharing this shape do
   * not set it. Handlers that need to know WHICH kind of credential called
   * (scoped API key vs legacy project key) read this.
   */
  resolvedToken?: RestResolvedProjectCredential;
};

/**
 * `organization` carries only an id because that is all an organization
 * credential resolves to: the resolved token is
 * `{ type, apiKeyId, userId, organizationId }` and the organization feature
 * publishes no scalar organization value.
 */
export type AppRestOrganizationVariables = {
  organization: { id: RestResolvedOrganizationCredential["organizationId"] };
  apiKeyId: string;
  apiKeyUserId: string | null;
  apiKeyOrganizationId: string;
  orgResolvedToken: RestResolvedOrganizationCredential;
};

// ─────────────────────────────────────────────────────────────────────────────
// The credential a REST request arrived with, as the thing a later permission
// question is asked ABOUT.
//
// A route's declared permission is checked by the chain before the handler
// runs. A handler that has to ask a SECOND question — "may this caller also see
// costs?" — used to have nowhere to ask it from and answered `true`, which
// handed a deliberately narrowed key the reach of whoever created it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The credential a project-scoped door resolved: a scoped key, or the legacy
 * project key carrying full project access by its class alone.
 * `isLangySessionKey` rides along because an agent's write is labelled apart
 * from a person's, and that fact lives on the key, not on its holder.
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
 * The principal behind a framework-authenticated project request.
 *
 * Raises rather than guessing when no credential was resolved: a handler
 * asking this on an unauthenticated request is a mis-wired route, and reading
 * a blank principal would widen an answer instead of failing. A plain `Error`
 * on purpose — it degrades to the generic unknown response (ADR-045) and logs
 * loudly, because no caller can act on it.
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

// ─────────────────────────────────────────────────────────────────────────────
// Who is behind a personal-workspace API key.
//
// Two REST reads answer for a PERSON rather than a project: `/api/me/usage` and
// the coding agent's pull-request usage. Both need the same two guards, and
// both live here rather than in each route, so one refusal cannot answer in two
// shapes.
//
// A legacy project key carries no user of its own. It IS that workspace's key,
// so its holder is the owner by construction. A MODERN key with no user is a
// service key, minted for a job rather than a person, which is why the guard
// takes the whole typed credential rather than a user id.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The calling key belongs to a workspace that is not one person's.
 *
 * Handled rather than a plain `Error`: we know exactly what is wrong and the
 * caller has one step to take, which is to use the key from their own personal
 * workspace.
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
 * The calling key belongs to a user who does not own the personal workspace it
 * is pointed at.
 *
 * Nothing identifies the owner, on the error or in `meta`: whose workspace this
 * is answers the very question the refusal exists to withhold.
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
 * The calling credential is a service key, which stands for no person.
 *
 * A personal read has to name whose data it answers for, and a service key
 * names nobody: answering for the workspace's owner would hand the key its
 * creator's identity rather than its own.
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
 * The user whose data a personal-workspace read answers for.
 *
 * Takes the resolved credential rather than fields picked off the request
 * context: the credential's CLASS is half the decision, and a caller that
 * reads two loose ids out of a context bag can only guess at it.
 *
 * @throws {PersonalProjectKeyRequiredError} when the workspace is not personal.
 * @throws {PersonalUsageKeyMismatchError} when a user-bound key does not own it.
 * @throws {PersonalUsageServiceKeyUnsupportedError} for an ownerless modern key.
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
